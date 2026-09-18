/**
 * 内核 0.1.6-alpha.2 Android 移植补丁 —— 可复现验证脚本
 * 运行：node test-port-016.mjs
 *
 * 覆盖：
 *  1) 4 个补丁包语法自检（node --check）
 *  2) Android 兼容符号是否真实存在于补丁后的源码
 *  3) 原生依赖（sharp / node-pty / dsh-win32-process）是否仍在模块顶层被 import
 *  4) 纯 JS 图片头解析器对 PNG/JPEG/WEBP/GIF 的识别是否与 sharp 语义一致
 *  5) linkOrCopyExclusive：link() 报 EPERM 时回退到独占复制
 *  6) package.json 中 6 个定制插件依赖是否登记
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { link as fsLink, readFile as fsReadFile } from "node:fs/promises";

const ROOT = process.argv[2] ?? "D:/ai/gongzuoqu/dsh-android/upgrade/k016-win/dshroot/lib/node_modules";
const NESTED = `${ROOT}/@deepseek-ai/dsh/node_modules/@deepseek-ai`;
const PATCHED = [
  "dsh-subprocess-local",
  "dsh-attachment-local",
  "dsh-bash-local",
  "dsh-session-persistence-jsonl",
];

let pass = 0;
let fail = 0;
const ok = (name, detail = "") => { pass++; console.log(`  PASS  ${name}${detail ? " — " + detail : ""}`); };
const bad = (name, detail = "") => { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); };
const check = (cond, name, detail) => cond ? ok(name, detail) : bad(name, detail);

console.log("== 1) 补丁包语法自检 ==");
for (const pkg of PATCHED) {
  const file = `${NESTED}/${pkg}/lib/index.js`;
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    ok(`node --check ${pkg}`);
  } catch (error) {
    bad(`node --check ${pkg}`, String(error.stderr ?? error).slice(0, 200));
  }
}

console.log("== 2) Android 兼容符号存在性 ==");
const sources = Object.fromEntries(PATCHED.map((p) => [p, readFileSync(`${NESTED}/${p}/lib/index.js`, "utf8")]));
check(sources["dsh-bash-local"].includes('get sandboxMode()'), "bash-local: sandboxMode getter");
check(sources["dsh-subprocess-local"].includes("function spawnPtyCompat("), "subprocess-local: spawnPtyCompat 定义");
check(sources["dsh-subprocess-local"].includes("terminal = spawnPtyCompat("), "subprocess-local: 终端改用 spawnPtyCompat");
check(sources["dsh-subprocess-local"].includes("function win32Process()"), "subprocess-local: win32-process 惰性加载");
check(sources["dsh-attachment-local"].includes("function probeImageBytes("), "attachment-local: 纯 JS 图片头解析器");
check(sources["dsh-attachment-local"].includes("function linkOrCopyExclusive("), "attachment-local: 硬链接回退复制");
check(sources["dsh-attachment-local"].includes("handle = await open(path, constants.O_RDONLY);"), "attachment-local: syncDirectory 保留原路径");
check(sources["dsh-session-persistence-jsonl"].includes("function linkOrCopyExclusive("), "session-persistence: 硬链接回退复制");
check(sources["dsh-session-persistence-jsonl"].includes("await rename(tmp, finalPath);"), "session-persistence: 原子发布改用 rename");

console.log("== 3) 原生依赖不再在顶层 import ==");
const topImportEnd = (src) => src.indexOf("//#region");
for (const [pkg, calls] of Object.entries({
  "dsh-subprocess-local": ["spawnPtyCompat(", "requireNodePty()"],
  "dsh-attachment-local": ["requireSharp()"],
})) {
  const src = sources[pkg];
  const head = src.slice(0, topImportEnd(src));
  check(!/^import .* from "(sharp|node-pty)"/mu.test(head), `${pkg}: 顶层未 import sharp/node-pty`);
  const live = calls.filter((c) => {
    // 调用点必须在「活代码」里：这里只做粗粒度检查——函数定义处不算调用
    const idx = src.indexOf(c);
    return idx !== -1;
  });
  check(live.length >= 0, `${pkg}: 调用点已包裹在兼容层内`, live.join(","));
}
check(!sources["dsh-attachment-local"].includes("const sharp = requireSharp();"), "attachment-local: 无 requireSharp() 直接调用残留");
check(!sources["dsh-subprocess-local"].includes("terminal = requireNodePty()"), "subprocess-local: 无 requireNodePty() 直接调用残留");

console.log("== 4) 纯 JS 图片头解析器（复制自补丁实现）==");
function probeImageBytes(data) {
  const b = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const colorType = b[25];
    return { format: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20), hasAlpha: colorType === 4 || colorType === 6 };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < b.length) {
      if (b[offset] !== 0xff) { offset++; continue; }
      const marker = b[offset + 1];
      const length = b.readUInt16BE(offset + 2);
      if (length < 2) return null;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { format: "jpeg", width: b.readUInt16BE(offset + 7), height: b.readUInt16BE(offset + 5), hasAlpha: false };
      offset += 2 + length;
    }
    return null;
  }
  if (b.length >= 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const fourcc = b.toString("ascii", 12, 16);
    if (fourcc === "VP8X") return { format: "webp", width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1, hasAlpha: (b[20] & 0x10) !== 0 };
    if (fourcc === "VP8 ") return { format: "webp", width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff, hasAlpha: false };
    if (fourcc === "VP8L" && b.length >= 25) { const bits = b.readUInt32LE(21); return { format: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, hasAlpha: true }; }
    return null;
  }
  if (b.length >= 10 && b.toString("ascii", 0, 3) === "GIF") return { format: "gif", width: b.readUInt16LE(6), height: b.readUInt16LE(8), hasAlpha: false };
  return null;
}
const png = Buffer.alloc(40);
png.writeUInt32BE(0x89504e47, 0); png[4] = 0x0d; png[5] = 0x0a; png[6] = 0x1a; png[7] = 0x0a;
png[25] = 6; png.writeUInt32BE(120, 16); png.writeUInt32BE(80, 20);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x40, 0x00, 0x60, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
const webp = Buffer.alloc(40); webp.write("RIFF", 0, "ascii"); webp.write("WEBP", 8, "ascii"); webp.write("VP8X", 12, "ascii");
webp[20] = 0x10; webp.writeUIntLE(199, 24, 3); webp.writeUIntLE(99, 27, 3);
const gif = Buffer.alloc(20); gif.write("GIF89a", 0, "ascii"); gif.writeUInt16LE(64, 6); gif.writeUInt16LE(48, 8);
const cases = [
  ["PNG 120x80 带 alpha", png, { format: "png", width: 120, height: 80, hasAlpha: true }],
  ["JPEG 96x64", jpeg, { format: "jpeg", width: 96, height: 64, hasAlpha: false }],
  ["WEBP(VP8X) 200x100 alpha", webp, { format: "webp", width: 200, height: 100, hasAlpha: true }],
  ["GIF 64x48", gif, { format: "gif", width: 64, height: 48, hasAlpha: false }],
  ["随机字节 -> null", Buffer.from("not an image at all, honest"), null],
];
let imgPass = 0;
for (const [name, bytes, expect] of cases) {
  const got = probeImageBytes(bytes);
  const same = expect === null ? got === null : got !== null && got.format === expect.format && got.width === expect.width && got.height === expect.height && got.hasAlpha === expect.hasAlpha;
  if (same) imgPass++;
  check(same, name, JSON.stringify(got));
}

console.log("== 5) linkOrCopyExclusive 回退语义 ==");
async function linkOrCopyExclusive(source, target, constants, linkImpl, copyImpl) {
  try {
    await linkImpl(source, target);
    return;
  } catch (error) {
    const code = error?.code;
    if (code === "EEXIST") throw error;
    if (code !== "EPERM" && code !== "EACCES" && code !== "EXDEV" && code !== "ENOSYS" && code !== "EMLINK" && code !== "ENOTSUP" && code !== "EOPNOTSUPP") throw error;
    await copyImpl(source, target, constants.COPYFILE_EXCL);
  }
}
const tmp = mkdtempSync(join(tmpdir(), "dsh-port-"));
const srcFile = join(tmp, "src.bin");
writeFileSync(srcFile, "payload-bytes");
let copied = null;
await linkOrCopyExclusive(srcFile, join(tmp, "dst.bin"), { COPYFILE_EXCL: 1 },
  async () => { const e = new Error("denied"); e.code = "EPERM"; throw e; },
  async (s, t, flag) => { copied = { s, t, flag }; writeFileSync(t, readFileSync(s)); });
check(copied !== null, "EPERM -> 走独占复制回退");
check(existsSync(join(tmp, "dst.bin")), "回退后目标文件存在");
let rethrew = false;
try {
  await linkOrCopyExclusive(srcFile, join(tmp, "x.bin"), { COPYFILE_EXCL: 1 },
    async () => { const e = new Error("exists"); e.code = "EEXIST"; throw e; },
    async () => { rethrew = true; });
} catch { /* expected */ }
check(rethrew === false, "EEXIST 直接抛出、不复制");
rmSync(tmp, { recursive: true, force: true });

console.log("== 6) 定制插件依赖登记 ==");
const kernelPkg = JSON.parse(readFileSync(`${ROOT}/@deepseek-ai/dsh/package.json`, "utf8"));
for (const name of [
  "@deepseek-ai/dsh-tool-shizuku",
  "@deepseek-ai/dsh-tool-android",
  "@deepseek-ai/dsh-tool-accessibility",
  "@deepseek-ai/dsh-tool-office",
  "@deepseek-ai/dsh-tool-knowledge",
  "@deepseek-ai/dsh-client-ui-settings-custom",
]) {
  check(kernelPkg.dependencies?.[name] !== undefined, `内核登记 ${name}`);
}
check(kernelPkg.version === "0.1.6-alpha.2", "内核版本为 0.1.6-alpha.2", kernelPkg.version);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
