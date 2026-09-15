/**
 * Port the upstream v1.7.5 Android adaptations onto a pristine DSH 0.1.5-rc.2 tree.
 * Usage: node patch-015.mjs <dshroot/lib>
 * Run once, on a clean npm install result.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const lib = process.argv[2];
if (!lib) throw new Error("usage: node patch-015.mjs <dshroot/lib>");
const NESTED = join(lib, "node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai");
const SUBP = join(NESTED, "dsh-subprocess-local/lib");
const ATT = join(NESTED, "dsh-attachment-local/lib");
const BASH = join(NESTED, "dsh-bash-local/lib");
const SESS = join(NESTED, "dsh-session-persistence-jsonl/lib");

function read(p) { return readFileSync(p, "utf8"); }
function write(p, s) { writeFileSync(p, s); }
function replaceOnce(src, find, repl, label) {
  const i = src.indexOf(find);
  if (i < 0) throw new Error("anchor not found: " + label);
  if (src.indexOf(find, i + find.length) >= 0) throw new Error("anchor not unique: " + label);
  return src.slice(0, i) + repl + src.slice(i + find.length);
}
function cut(src, startFind, endFind, repl, label) {
  const i = src.indexOf(startFind);
  if (i < 0) throw new Error("start not found: " + label);
  const j = src.indexOf(endFind, i + startFind.length);
  if (j < 0) throw new Error("end not found: " + label);
  return src.slice(0, i) + repl + src.slice(j);
}
const log = (m) => console.log("  " + m);

/* ---------- 1. dsh-bash-local: add sandboxMode getter ---------- */
{
  const p = join(BASH, "index.js");
  let s = read(p);
  const anchor = 'static inject = ["subprocess"];';
  s = replaceOnce(s, anchor, anchor + "\n\t/** Android compatibility: report workspace-write mode (matches the default 'ask' approval preset). */\n\tget sandboxMode() {\n\t\treturn \"workspace-write\";\n\t}", "bash sandboxMode");
  write(p, s);
  log("bash-local: sandboxMode getter injected");
}

/* ---------- 2. dsh-session-persistence-jsonl: link -> rename / link+copy ---------- */
{
  const p = join(SESS, "index.js");
  let s = read(p);
  const oldImport = 'import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, truncate } from "node:fs/promises";';
  const newImport = 'import { constants as fsConstants, copyFile, link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, truncate } from "node:fs/promises";';
  s = replaceOnce(s, oldImport, newImport + "\n/** Android compatibility: SELinux/FS may deny hard links; fall back to an exclusive copy. */\nasync function linkOrCopyExclusive(source, target) {\n\ttry {\n\t\tawait link(source, target);\n\t\treturn;\n\t} catch (error) {\n\t\tconst code = error?.code;\n\t\tif (code === \"EEXIST\") throw error;\n\t\tif (code !== \"EPERM\" && code !== \"EACCES\" && code !== \"EXDEV\" && code !== \"ENOSYS\" && code !== \"EMLINK\" && code !== \"ENOTSUP\" && code !== \"EOPNOTSUPP\") throw error;\n\t\tawait copyFile(source, target, fsConstants.COPYFILE_EXCL);\n\t}\n}", "session import");
  s = replaceOnce(s, "await internals.fs.link(staged, currentPath);", "await linkOrCopyExclusive(staged, currentPath);", "session publishCurrentExclusive");
  const oldBlock = "\t\tlet linked = false;\n\t\ttry {\n\t\t\tawait link(tmp, finalPath);\n\t\t\tlinked = true;\n\t\t} finally {\n\t\t\t/* v8 ignore next -- link failure is the TOCTOU/IO race guarded above; not reachable in test */\n\t\t\tif (!linked) await rm(tmp, { force: true });\n\t\t}\n\t\tawait this.syncDirPosix(dir);\n\t\ttry {\n\t\t\tawait rm(tmp, { force: true });\n\t\t} catch {}";
  const newBlock = "\t\ttry {\n\t\t\tawait rename(tmp, finalPath);\n\t\t} catch (error) {\n\t\t\tawait rm(tmp, { force: true });\n\t\t\tthrow error;\n\t\t}\n\t\tawait this.syncDirPosix(dir);";
  s = replaceOnce(s, oldBlock, newBlock, "session materializePosix");
  write(p, s);
  log("session-persistence-jsonl: link->rename/linkOrCopy applied");
}

/* ---------- 3. dsh-subprocess-local/runner-launch: drop top-level koffi ---------- */
{
  const p = join(SUBP, "runner-launch-COYGu0Dl.js");
  let s = read(p);
  s = cut(s, "//#region lib/types/windows-inspector.js", "//#region lib/types/process-inspector.js", "//#region lib/types/process-inspector.js", "runner windows region");
  s = replaceOnce(s, 'import koffi from "koffi";', 'import { createRequire } from "node:module";\nlet cachedKoffi;\n/** Android compatibility: load koffi lazily so a missing Android native binding never breaks module load. */\nfunction loadKoffi() {\n\tif (cachedKoffi !== void 0) return cachedKoffi;\n\tcachedKoffi = createRequire(import.meta.url)("koffi");\n\treturn cachedKoffi;\n}', "runner koffi import");
  s = replaceOnce(s, "\tif (platform === \"win32\") return createWindowsProcessInspector();\n", "", "runner win32 inspector branch");
  s = s.split("koffi.load(null)").join("loadKoffi().load(null)");
  s = s.split("koffi.errno()").join("loadKoffi().errno()");
  write(p, s);
  log("subprocess-local/runner-launch: windows-inspector removed, koffi lazy");
}

/* ---------- 4. dsh-subprocess-local/index.js: node-pty -> child_process ---------- */
{
  const p = join(SUBP, "index.js");
  let s = read(p);
  s = replaceOnce(s, 'import * as nodePty from "node-pty";\n', "", "subp node-pty import");
  s = replaceOnce(s, 'import { loadWin32ProcessBindings, probeCurrentTokenJobSupport } from "@deepseek-ai/dsh-win32-process";\n',
    'import { createRequire } from "node:module";\nlet cachedWin32Process;\n/** Android compatibility: load the Win32 binding package (koffi native) lazily. */\nfunction win32Process() {\n\tif (cachedWin32Process !== void 0) return cachedWin32Process;\n\tcachedWin32Process = createRequire(import.meta.url)("@deepseek-ai/dsh-win32-process");\n\treturn cachedWin32Process;\n}\nfunction loadWin32ProcessBindings(...args) { return win32Process().loadWin32ProcessBindings(...args); }\nfunction probeCurrentTokenJobSupport(...args) { return win32Process().probeCurrentTokenJobSupport(...args); }\n',
    "subp win32-process import");
  const compat = '\nfunction signalNumberCompat(name) {\n\tif (name === void 0 || name === null || name === "") return void 0;\n\tconst number = constants$1.signals[name];\n\treturn typeof number === "number" ? number : void 0;\n}\n/**\n* Android-compatible node-pty replacement: spawns a plain child_process and\n* exposes the minimal node-pty surface LocalTerminalHandle relies on\n* (pid / onData / onExit / write / kill / resize). Interactive PTY features\n* (rows/cols, resize) degrade to no-ops.\n*/\nfunction spawnPtyCompat(file, args, options) {\n\tconst child = spawn(file, args, {\n\t\tcwd: options.cwd,\n\t\tenv: options.env,\n\t\tstdio: ["pipe", "pipe", "pipe"]\n\t});\n\treturn {\n\t\tpid: child.pid,\n\t\tonData(callback) {\n\t\t\tchild.stdout.on("data", (chunk) => callback(chunk.toString("utf8")));\n\t\t\treturn { dispose() {} };\n\t\t},\n\t\tonExit(callback) {\n\t\t\tconst handler = (code, signal) => callback({ exitCode: code, signal: signalNumberCompat(signal) });\n\t\t\tchild.on("exit", handler);\n\t\t\treturn { dispose() { child.off("exit", handler); } };\n\t\t},\n\t\twrite(data) {\n\t\t\tif (child.stdin.writable) child.stdin.write(data);\n\t\t},\n\t\tkill(signal) {\n\t\t\ttry { child.kill(signal); } catch {}\n\t\t},\n\t\tresize() {}\n\t};\n}\n';
  s = replaceOnce(s, "function signalName(number) {", compat + "function signalName(number) {", "subp compat insert");
  s = replaceOnce(s, "nodePty.spawn(", "spawnPtyCompat(", "subp nodePty.spawn");
  write(p, s);
  log("subprocess-local/index.js: node-pty compat injected");
}

/* ---------- 5. dsh-attachment-local: remove sharp ---------- */
{
  const p = join(ATT, "index.js");
  let s = read(p);
  s = replaceOnce(s, 'import sharp from "sharp";\n', "", "att sharp import");
  s = replaceOnce(s, 'import { chmod, link, mkdir, open, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";',
    'import { chmod, copyFile, link, mkdir, open, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";\n/** Android compatibility: SELinux/FS may deny hard links; fall back to an exclusive copy. */\nasync function linkOrCopyExclusive(source, target) {\n\ttry {\n\t\tawait link(source, target);\n\t\treturn;\n\t} catch (error) {\n\t\tconst code = error?.code;\n\t\tif (code === "EEXIST") throw error;\n\t\tif (code !== "EPERM" && code !== "EACCES" && code !== "EXDEV" && code !== "ENOSYS" && code !== "EMLINK" && code !== "ENOTSUP" && code !== "EOPNOTSUPP") throw error;\n\t\tawait copyFile(source, target, constants.COPYFILE_EXCL);\n\t}\n}', "att import");

  const imageAndNorm = Buffer.from("ZnVuY3Rpb24gZW5jb2RlZEFscGhhSXNDb21wYXRpYmxlKHNvdXJjZUhhc0FscGhhLCBvdXRwdXQpIHsKCXJldHVybiBzb3VyY2VIYXNBbHBoYSA9PT0gdm9pZCAwIHx8IG91dHB1dC5oYXNBbHBoYSA9PT0gc291cmNlSGFzQWxwaGEgfHwgc291cmNlSGFzQWxwaGEgJiYgIW91dHB1dC5oYXNBbHBoYSAmJiBvdXRwdXQubWVkaWFUeXBlID09PSAiaW1hZ2Uvd2VicCI7Cn0KY29uc3QgTUVESUFfVFlQRVMgPSB7Cglwbmc6ICJpbWFnZS9wbmciLAoJanBlZzogImltYWdlL2pwZWciLAoJd2VicDogImltYWdlL3dlYnAiLAoJZ2lmOiAiaW1hZ2UvZ2lmIgp9OwovKiogQW5kcm9pZCBjb21wYXRpYmlsaXR5OiBwdXJlIEpTIGhlYWRlciBwcm9iZSByZXBsYWNpbmcgc2hhcnAvbGlidmlwcyAobm8gbmF0aXZlIGltYWdlIGNvZGVjIG9uIEFuZHJvaWQpLiAqLwpmdW5jdGlvbiBwcm9iZUltYWdlQnl0ZXMoZGF0YSkgewoJY29uc3QgYiA9IEJ1ZmZlci5pc0J1ZmZlcihkYXRhKSA/IGRhdGEgOiBCdWZmZXIuZnJvbShkYXRhKTsKCWlmIChiLmxlbmd0aCA+PSAyNCAmJiBiWzBdID09PSAweDg5ICYmIGJbMV0gPT09IDB4NTAgJiYgYlsyXSA9PT0gMHg0ZSAmJiBiWzNdID09PSAweDQ3KSB7CgkJY29uc3QgY29sb3JUeXBlID0gYlsyNV07CgkJcmV0dXJuIHsgZm9ybWF0OiAicG5nIiwgd2lkdGg6IGIucmVhZFVJbnQzMkJFKDE2KSwgaGVpZ2h0OiBiLnJlYWRVSW50MzJCRSgyMCksIGhhc0FscGhhOiBjb2xvclR5cGUgPT09IDQgfHwgY29sb3JUeXBlID09PSA2IH07Cgl9CglpZiAoYi5sZW5ndGggPj0gNCAmJiBiWzBdID09PSAweGZmICYmIGJbMV0gPT09IDB4ZDgpIHsKCQlsZXQgb2Zmc2V0ID0gMjsKCQl3aGlsZSAob2Zmc2V0ICsgOSA8IGIubGVuZ3RoKSB7CgkJCWlmIChiW29mZnNldF0gIT09IDB4ZmYpIHsgb2Zmc2V0Kys7IGNvbnRpbnVlOyB9CgkJCWNvbnN0IG1hcmtlciA9IGJbb2Zmc2V0ICsgMV07CgkJCWNvbnN0IGxlbmd0aCA9IGIucmVhZFVJbnQxNkJFKG9mZnNldCArIDIpOwoJCQlpZiAobGVuZ3RoIDwgMikgcmV0dXJuIG51bGw7CgkJCWlmIChtYXJrZXIgPj0gMHhjMCAmJiBtYXJrZXIgPD0gMHhjZiAmJiBtYXJrZXIgIT09IDB4YzQgJiYgbWFya2VyICE9PSAweGM4ICYmIG1hcmtlciAhPT0gMHhjYykgcmV0dXJuIHsgZm9ybWF0OiAianBlZyIsIHdpZHRoOiBiLnJlYWRVSW50MTZCRShvZmZzZXQgKyA3KSwgaGVpZ2h0OiBiLnJlYWRVSW50MTZCRShvZmZzZXQgKyA1KSwgaGFzQWxwaGE6IGZhbHNlIH07CgkJCW9mZnNldCArPSAyICsgbGVuZ3RoOwoJCX0KCQlyZXR1cm4gbnVsbDsKCX0KCWlmIChiLmxlbmd0aCA+PSAzMCAmJiBiLnRvU3RyaW5nKCJhc2NpaSIsIDAsIDQpID09PSAiUklGRiIgJiYgYi50b1N0cmluZygiYXNjaWkiLCA4LCAxMikgPT09ICJXRUJQIikgewoJCWNvbnN0IGZvdXJjYyA9IGIudG9TdHJpbmcoImFzY2lpIiwgMTIsIDE2KTsKCQlpZiAoZm91cmNjID09PSAiVlA4WCIpIHJldHVybiB7IGZvcm1hdDogIndlYnAiLCB3aWR0aDogYi5yZWFkVUludExFKDI0LCAzKSArIDEsIGhlaWdodDogYi5yZWFkVUludExFKDI3LCAzKSArIDEsIGhhc0FscGhhOiAoYlsyMF0gJiAweDEwKSAhPT0gMCB9OwoJCWlmIChmb3VyY2MgPT09ICJWUDggIikgcmV0dXJuIHsgZm9ybWF0OiAid2VicCIsIHdpZHRoOiBiLnJlYWRVSW50MTZMRSgyNikgJiAweDNmZmYsIGhlaWdodDogYi5yZWFkVUludDE2TEUoMjgpICYgMHgzZmZmLCBoYXNBbHBoYTogZmFsc2UgfTsKCQlpZiAoZm91cmNjID09PSAiVlA4TCIgJiYgYi5sZW5ndGggPj0gMjUpIHsgY29uc3QgYml0cyA9IGIucmVhZFVJbnQzMkxFKDIxKTsgcmV0dXJuIHsgZm9ybWF0OiAid2VicCIsIHdpZHRoOiAoYml0cyAmIDB4M2ZmZikgKyAxLCBoZWlnaHQ6ICgoYml0cyA+PiAxNCkgJiAweDNmZmYpICsgMSwgaGFzQWxwaGE6IHRydWUgfTsgfQoJCXJldHVybiBudWxsOwoJfQoJaWYgKGIubGVuZ3RoID49IDEwICYmIGIudG9TdHJpbmcoImFzY2lpIiwgMCwgMykgPT09ICJHSUYiKSByZXR1cm4geyBmb3JtYXQ6ICJnaWYiLCB3aWR0aDogYi5yZWFkVUludDE2TEUoNiksIGhlaWdodDogYi5yZWFkVUludDE2TEUoOCksIGhhc0FscGhhOiBmYWxzZSB9OwoJcmV0dXJuIG51bGw7Cn0KZnVuY3Rpb24gaW1hZ2VNZXRhZGF0YShkYXRhKSB7Cgljb25zdCBwcm9iZWQgPSBwcm9iZUltYWdlQnl0ZXMoZGF0YSk7CglpZiAocHJvYmVkID09PSBudWxsKSB0aHJvdyBuZXcgQXR0YWNobWVudEVycm9yKCJVbnN1cHBvcnRlZCBvciBtYWxmb3JtZWQgaW1hZ2UgZGF0YS4iLCAiSU5WQUxJRF9JTUFHRSIpOwoJY29uc3QgbWVkaWFUeXBlID0gTUVESUFfVFlQRVNbcHJvYmVkLmZvcm1hdF07CglpZiAobWVkaWFUeXBlID09PSB2b2lkIDApIHRocm93IG5ldyBBdHRhY2htZW50RXJyb3IoIlVuc3VwcG9ydGVkIG9yIG1hbGZvcm1lZCBpbWFnZSBkYXRhLiIsICJJTlZBTElEX0lNQUdFIik7CglyZXR1cm4gewoJCW1lZGlhVHlwZSwKCQl3aWR0aDogcHJvYmVkLndpZHRoLAoJCWhlaWdodDogcHJvYmVkLmhlaWdodCwKCQlhbmltYXRlZDogZmFsc2UsCgkJY2Fycmllc01ldGFkYXRhOiBmYWxzZSwKCQlkZXB0aDogInVjaGFyIiwKCQlzcGFjZTogInNyZ2IiLAoJCWhhc0FscGhhOiBwcm9iZWQuaGFzQWxwaGEKCX07Cn0KYXN5bmMgZnVuY3Rpb24gcHJvYmVJbWFnZShkYXRhKSB7Cgl0cnkgeyByZXR1cm4gaW1hZ2VNZXRhZGF0YShkYXRhKTsgfQoJY2F0Y2ggKGVycm9yKSB7CgkJaWYgKGVycm9yIGluc3RhbmNlb2YgQXR0YWNobWVudEVycm9yKSB0aHJvdyBlcnJvcjsKCQl0aHJvdyBuZXcgQXR0YWNobWVudEVycm9yKCJVbnN1cHBvcnRlZCBvciBtYWxmb3JtZWQgaW1hZ2UgZGF0YS4iLCAiSU5WQUxJRF9JTUFHRSIsIHsgY2F1c2U6IGVycm9yIH0pOwoJfQp9CmFzeW5jIGZ1bmN0aW9uIGRldGVjdEltYWdlKGRhdGEsIGxpbWl0cykgewoJY29uc3QgZGV0ZWN0ZWQgPSBhd2FpdCBwcm9iZUltYWdlKGRhdGEpOwoJaWYgKGxpbWl0cz8ubWF4UGl4ZWxzICE9PSB2b2lkIDAgJiYgZGV0ZWN0ZWQud2lkdGggKiBkZXRlY3RlZC5oZWlnaHQgPiBsaW1pdHMubWF4UGl4ZWxzKSB0aHJvdyBuZXcgQXR0YWNobWVudEVycm9yKCJJbWFnZSBleGNlZWRzIHRoZSBjb25maWd1cmVkIGRlY29kZWQtcGl4ZWwgbGltaXQuIiwgIklNQUdFX1RPT19NQU5ZX1BJWEVMUyIpOwoJaWYgKGxpbWl0cz8ubWF4RGltZW5zaW9uICE9PSB2b2lkIDAgJiYgTWF0aC5tYXgoZGV0ZWN0ZWQud2lkdGgsIGRldGVjdGVkLmhlaWdodCkgPiBsaW1pdHMubWF4RGltZW5zaW9uKSB0aHJvdyBuZXcgQXR0YWNobWVudEVycm9yKCJJbWFnZSBleGNlZWRzIHRoZSBjb25maWd1cmVkIHBlci1zaWRlIHBpeGVsIGxpbWl0LiIsICJJTUFHRV9ESU1FTlNJT05fVE9PX0xBUkdFIik7CglyZXR1cm4gZGV0ZWN0ZWQ7Cn0KLy8jZW5kcmVnaW9uCi8vI3JlZ2lvbiBsaWIvdHlwZXMvbm9ybWFsaXphdGlvbi5qcwovKiogQW5kcm9pZCBjb21wYXRpYmlsaXR5OiBubyBuYXRpdmUgaW1hZ2UgY29kZWMsIG5vcm1hbGl6YXRpb24gYmVjb21lcyBhIGJ5dGUtaWRlbnRpY2FsIHBhc3MtdGhyb3VnaC4gKi8KZnVuY3Rpb24gY2FuUGFzc1Rocm91Z2hOb3JtYWxpemF0aW9uKCkgewoJcmV0dXJuIHRydWU7Cn0KYXN5bmMgZnVuY3Rpb24gbm9ybWFsaXplSW1hZ2UoZGF0YSwgZGV0ZWN0ZWQpIHsKCXJldHVybiB7CgkJZGF0YSwKCQltZWRpYVR5cGU6IGRldGVjdGVkLm1lZGlhVHlwZSwKCQl3aWR0aDogZGV0ZWN0ZWQud2lkdGgsCgkJaGVpZ2h0OiBkZXRlY3RlZC5oZWlnaHQKCX07Cn0KLy8jZW5kcmVnaW9uCg==", "base64").toString("utf8");
  s = cut(s, "function encodedAlphaIsCompatible(sourceHasAlpha, output) {", "//#region lib/types/store.js", imageAndNorm, "att image+normalization region");

  const oldPub = "\t\ttry {\n\t\t\tawait link(staged.path, target);\n\t\t} catch (error) {\n\t\t\t/* v8 ignore next -- Private same-filesystem directories make EEXIST the only recoverable link race. */\n\t\t\tif (!(error instanceof Error && \"code\" in error && error.code === \"EEXIST\")) throw error;\n\t\t\tif (await digestFile(target) !== staged.sha256) throw new AttachmentError(\"Stored attachment failed integrity verification.\", \"ATTACHMENT_CORRUPT\");\n\t\t}\n\t\tawait unlink(staged.path);\n\t\tawait chmod(target, 256);";
  const newPub = "\t\ttry {\n\t\t\tawait rename(staged.path, target);\n\t\t} catch (error) {\n\t\t\t/* v8 ignore next -- Private same-filesystem directories make EEXIST the only recoverable race. */\n\t\t\tif (!(error instanceof Error && \"code\" in error && error.code === \"EEXIST\")) throw error;\n\t\t\tif (await digestFile(target) !== staged.sha256) throw new AttachmentError(\"Stored attachment failed integrity verification.\", \"ATTACHMENT_CORRUPT\");\n\t\t}\n\t\tawait unlink(staged.path).catch(() => {});\n\t\tawait chmod(target, 256);";
  s = replaceOnce(s, oldPub, newPub, "att publishStagedObject");

  s = replaceOnce(s, "\t\t\tawait link(source, target);", "\t\t\tawait linkOrCopyExclusive(source, target);", "att alias link");

  s = replaceOnce(s, "\tconst handle = await open(path, constants.O_RDONLY);",
    "\tlet handle;\n\ttry {\n\t\thandle = await open(path, constants.O_RDONLY);\n\t} catch (error) {\n\t\t/* Android/restricted: ancestor directories may deny open; directory fsync is best-effort. */\n\t\tif (error && (error.code === \"EACCES\" || error.code === \"EPERM\")) return;\n\t\tthrow error;\n\t}", "att syncDirectory");

  const oldCreate = "async function createRequestImage(attachment, policy, hasAlpha) {\n\tconst dimensions = requestImageDimensions(attachment.ref.width, attachment.ref.height, policy.maxPixels);\n\tif (dimensions.width === attachment.ref.width && dimensions.height === attachment.ref.height && attachment.data.byteLength <= policy.maxBytes) return {\n\t\tdata: attachment.data,\n\t\tmediaType: attachment.ref.mediaType,\n\t\twidth: attachment.ref.width,\n\t\theight: attachment.ref.height\n\t};\n\tconst encodedVersion = await encodeFirstWithinLimit(encodingLadder(pipeline(attachment, dimensions.width, dimensions.height), hasAlpha), policy.maxBytes);\n\treturn isExhaustedEncoding(encodedVersion) ? encodedVersion.smallest : encodedVersion;\n}";
  const newCreate = "async function createRequestImage(attachment, policy, hasAlpha) {\n\t/* Android compatibility: no image codec, reuse the original attachment as the request version. */\n\tvoid policy;\n\tvoid hasAlpha;\n\treturn {\n\t\tdata: attachment.data,\n\t\tmediaType: attachment.ref.mediaType,\n\t\twidth: attachment.ref.width,\n\t\theight: attachment.ref.height\n\t};\n}";
  s = replaceOnce(s, oldCreate, newCreate, "att createRequestImage");

  write(p, s);
  log("attachment-local: sharp removed, pure JS header probe + pass-through");
}

/* ---------- 6. dsh-client-connection: loopback WebView 无法做令牌交换，关闭浏览器令牌校验 ---------- */
{
  const p = join(lib, "node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js");
  let s = read(p);
  s = replaceOnce(s,
    "\tauthorizeIndex(req, res) {\n\t\t/* v8 ignore next -- node:http always supplies url on server requests. */",
    "\tauthorizeIndex(req, res) {\n\t\t/* Android compatibility: the packaged WebView cannot perform the launch-token exchange;\n\t\t   the server binds 127.0.0.1 only, matching the pre-0.1.5 behavior. */\n\t\treturn true;\n\t\t/* v8 ignore next -- node:http always supplies url on server requests. */",
    "connection authorizeIndex");
  s = replaceOnce(s,
    "\tisAuthenticated(request) {\n\t\tconst authority = requestAuthority(request.headers);",
    "\tisAuthenticated(request) {\n\t\t/* Android compatibility: loopback-only server, token exchange disabled (see authorizeIndex). */\n\t\treturn true;\n\t\tconst authority = requestAuthority(request.headers);",
    "connection isAuthenticated");
  write(p, s);
  log("client-connection: browser token check disabled (loopback only)");
}

/* ---------- 7. node-addon-system/flock: Android 无原生 flock，单进程直接放行 ---------- */
{
  const p = join(lib, "node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/node-addon-system/lib/flock.js");
  let s = read(p);
  const find = "export async function tryLockExclusive(fd) {\n    const errno = await new Promise((resolve) => {\n        loadBinding().tryLock(fd, resolve);\n    });";
  const repl = "export async function tryLockExclusive(fd) {\n    /* Android compatibility: no native flock binding exists for bionic.\n       The packaged engine is single-process, so the in-process write claim\n       already excludes every writer (same reasoning as the browser worker stub). */\n    if (process.platform === 'android')\n        return;\n    const errno = await new Promise((resolve) => {\n        loadBinding().tryLock(fd, resolve);\n    });";
  s = replaceOnce(s, find, repl, "flock android");
  write(p, s);
  log("node-addon-system/flock: android no-op lock");
}

console.log("patch-015: all patches applied");
