// 守卫逻辑单测：复制实现，注入 platform/header/resolve 三种事实
function guard({ platform, arch = "arm64", header, resolveOk }) {
  if (platform === "android") return true;
  if (platform !== "linux") return false;
  if (header !== undefined && header.platform === "android") return true;
  if (header !== undefined && header.glibcVersionRuntime === undefined && header.muslVersionRuntime === undefined) {
    try {
      if (!resolveOk()) throw new Error("cannot resolve");
    } catch { return true; }
  }
  return false;
}
const cases = [
  ["Android 上报 platform=android", { platform: "android", header: { platform: "android" }, resolveOk: () => true }, true],
  ["bionic 报 linux，且平台包不存在", { platform: "linux", header: {}, resolveOk: () => false }, true],
  ["bionic 报 linux，平台包恰好存在", { platform: "linux", header: {}, resolveOk: () => true }, false],
  ["Linux + glibc", { platform: "linux", header: { glibcVersionRuntime: "2.39" }, resolveOk: () => true }, false],
  ["Linux + musl", { platform: "linux", header: { muslVersionRuntime: "1.2.5" }, resolveOk: () => true }, false],
  ["Linux + glibc 但平台包缺失（异常环境）", { platform: "linux", header: { glibcVersionRuntime: "2.39" }, resolveOk: () => false }, false],
  ["darwin", { platform: "darwin", header: {}, resolveOk: () => true }, false],
  ["win32", { platform: "win32", header: {}, resolveOk: () => true }, false],
];
let pass = 0;
for (const [name, input, expect] of cases) {
  const got = guard(input);
  const ok = got === expect;
  if (ok) pass++;
  console.log((ok ? "PASS " : "FAIL ") + name.padEnd(34) + " -> " + got);
}
console.log(pass + "/" + cases.length + " 通过");
process.exit(pass === cases.length ? 0 : 1);
