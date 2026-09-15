/**
 * 持久化 Root Shell 通道 —— Oppo Find X7 / ColorOS 定制版
 *
 * 设计目标（相对官方 v1.7.5 的 suCmd）：
 *   1. su 路径自动发现：ColorOS 上 su 可能不在 PATH（Magisk / KernelSU / APatch / 内置 root
 *      的安装位置各不相同），逐个候选路径探测，选第一个能返回 uid=0 的。
 *   2. 持久化 root shell：只启动一次 su，后续命令复用同一个 shell 进程。
 *      - 命令间**保留状态**（cd / 环境变量 / 别名），和电脑端终端一致；
 *      - 免去每次 su -c 的进程启动 + Magisk 鉴权开销，连续系统操作快一个数量级。
 *   3. 哨兵分帧：命令后面追加 printf 标记 + $?，据此精确切分输出与退出码，
 *      不会把上一条命令的残留输出算进来。
 *   4. 健壮性：命令超时 → 杀掉并重建 shell；shell 意外退出 → 立刻失败挂起请求；
 *      初始化失败 → 自动回退一次性 su -c。
 *
 * 所有对外函数返回 { ok, exit_code, stdout, stderr, error? }，与旧 suCmd 结构一致，
 * 因此插件里其它代码无需改动。
 */
import { spawn } from "node:child_process";

export const MAX_STDOUT = 30000;
export const MAX_STDERR = 8000;

const INIT_TIMEOUT = 25000;
const MAX_TIMEOUT = 900000;

/** su 候选路径：环境变量 SU_BIN（App 探测结果）优先，其后是各 root 方案常见位置。 */
const SU_CANDIDATES = [
  process.env.SU_BIN,
  "/system/bin/su",
  "/system/xbin/su",
  "/sbin/su",
  "/debug_ramdisk/su",
  "/system/sbin/su",
  "/vendor/bin/su",
  "/product/bin/su",
  "/data/adb/magisk/su",
  "/data/adb/ksu/bin/su",
  "su"
].filter(function (v) { return typeof v === "string" && v.length > 0; });

/** 剥离会污染系统二进制的环境变量（Node 运行时注入的 LD_LIBRARY_PATH 指向自带 .so）。 */
function cleanEnv() {
  const e = Object.assign({}, process.env);
  delete e.LD_LIBRARY_PATH;
  delete e.LD_PRELOAD;
  delete e.LD_DEBUG;
  return e;
}

/** POSIX 单引号转义，用于把任意字符串安全拼进 shell 命令。 */
export function shellQuote(s) {
  return "'" + String(s).split("'").join("'\\''") + "'";
}

/** 构造「分块读取文件为 base64」的 shell 命令（dd + base64 + 去换行，二进制安全）。 */
export function fileReadCommand(path, offset, length) {
  return "dd if=" + shellQuote(path) + " bs=1 skip=" + offset + " count=" + length +
    " 2>/dev/null | base64 | tr -d '\\n'";
}

/**
 * 构造「把 base64 内容写入文件」的 shell 命令列表。
 * 分块（每块 8000 字符）追加写入，避免单条命令过长；append=false 时先截断。
 */
export function fileWriteCommands(path, base64, append, mode) {
  const q = shellQuote(path);
  const cmds = [];
  if (!append) cmds.push(": > " + q);
  const CHUNK = 8000;
  for (let i = 0; i < base64.length; i += CHUNK) {
    cmds.push("printf '%s' '" + base64.slice(i, i + CHUNK) + "' | base64 -d >> " + q);
  }
  const m = String(mode || "").replace(/[^0-7]/g, "");
  if (m) cmds.push("chmod " + m + " " + q);
  return cmds;
}

/** 一次性执行（非持久化），用于 su 探测与持久化 shell 不可用时的回退。 */
function once(bin, args, timeoutMs) {
  return new Promise(function (resolve) {
    let child;
    try {
      child = spawn(bin, args, { env: cleanEnv(), stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      resolve({ ok: false, exit_code: -1, stdout: "", stderr: "", error: String((e && e.message) || e) });
      return;
    }
    let out = "";
    let err = "";
    let done = false;
    const timer = setTimeout(function () {
      try { child.kill("SIGKILL"); } catch (_) {}
    }, Math.max(1000, Math.min(timeoutMs || 30000, MAX_TIMEOUT)));

    function finish(ok, code, error) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const r = { ok: ok, exit_code: code, stdout: out.trim().slice(0, MAX_STDOUT), stderr: err.trim().slice(0, MAX_STDERR) };
      if (error) r.error = error;
      resolve(r);
    }

    child.stdout.on("data", function (d) { out += d; });
    child.stderr.on("data", function (d) { err += d; });
    child.on("error", function (e) { finish(false, -1, String((e && e.message) || e)); });
    child.on("close", function (code, signal) {
      if (signal === "SIGKILL" && code === null) {
        finish(false, -1, "命令超时被强制终止");
      } else {
        finish(code === 0, code === null ? -1 : code, undefined);
      }
    });
  });
}

let suProbe = null;
let resolvedSu = null;

/** 探测可用的 su（结果记忆化；失败不缓存，允许用户授权后重试）。 */
export function resolveSuPath() {
  if (suProbe) return suProbe;
  suProbe = (async function () {
    for (let i = 0; i < SU_CANDIDATES.length; i++) {
      const cand = SU_CANDIDATES[i];
      const r = await once(cand, ["-c", "id"], 12000);
      if (r.ok && /uid=0/.test(r.stdout || "")) {
        resolvedSu = { bin: cand, id: (r.stdout || "").trim() };
        return resolvedSu;
      }
    }
    suProbe = null;
    return null;
  })();
  return suProbe;
}

/** 同步暴露已探测到的 su 路径（未探测时为 null），供状态工具使用。 */
export function knownSuPath() {
  return resolvedSu ? resolvedSu.bin : null;
}

export class RootShell {
  constructor(bin, initCheck) {
    this.bin = bin;
    // 初始化握手校验：生产环境必须确认是 root（uid=0）；测试时可注入其它正则。
    this.initCheck = initCheck || /uid=0/;
    // 若持久 shell 启动失败（本设备的 su 不支持无参交互 shell），记住失败时间，
    // 5 分钟内直接走一次性 su -c，避免每条命令都白等一次初始化超时。
    this.startFailedAt = 0;
    this.child = null;
    this.starting = null;
    this.seq = 0;
    this.pending = null;
    this.queue = Promise.resolve();
  }

  /** 启动（或复用）持久 root shell，并完成握手校验。 */
  ensure() {
    if (this.child) return Promise.resolve(true);
    if (this.starting) return this.starting;
    const self = this;
    this.starting = (async function () {
      const child = spawn(self.bin, [], { env: cleanEnv(), stdio: ["pipe", "pipe", "pipe"] });
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      self.child = child;
      child.stdout.on("data", function (d) { self.onData("out", d); });
      child.stderr.on("data", function (d) { self.onData("err", d); });
      child.on("close", function () { self.onExit(new Error("root shell 进程已退出")); });
      child.on("error", function (e) { self.onExit(e); });

      const init =
        "unset LD_LIBRARY_PATH LD_PRELOAD LD_DEBUG 2>/dev/null\n" +
        "export PATH=/data/adb/magisk:/data/adb/ksu/bin:/system/bin:/system/xbin:/vendor/bin:/product/bin:/sbin:$PATH\n" +
        "export TERM=xterm\n" +
        "cd /\n" +
        "id";
      const probe = await self.raw(init, INIT_TIMEOUT);
      if (!probe.ok || !self.initCheck.test(probe.stdout || "")) {
        self.destroy();
        throw new Error("root shell 初始化失败：" + (probe.error || probe.stderr || probe.stdout || "未知原因"));
      }
      return true;
    })();
    return this.starting.then(
      function (v) { self.starting = null; return v; },
      function (e) { self.starting = null; throw e; }
    );
  }

  onData(which, chunk) {
    const p = this.pending;
    if (!p) return;
    if (which === "err") { p.err += chunk; return; }
    p.out += chunk;
    const idx = p.out.indexOf(p.token);
    if (idx < 0) return;
    const m = /^(\d+)/.exec(p.out.slice(idx + p.token.length));
    if (!m) return;
    const body = p.out.slice(0, idx);
    clearTimeout(p.timer);
    if (this.pending === p) this.pending = null;
    const code = Number(m[1]);
    p.resolve({
      ok: code === 0,
      exit_code: code,
      stdout: body.trim().slice(0, MAX_STDOUT),
      stderr: p.err.trim().slice(0, MAX_STDERR)
    });
  }

  onExit(err) {
    this.child = null;
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    clearTimeout(p.timer);
    p.resolve({
      ok: false,
      exit_code: -1,
      stdout: p.out.trim().slice(0, MAX_STDOUT),
      stderr: p.err.trim().slice(0, MAX_STDERR),
      error: "root shell 已退出：" + String((err && err.message) || err || "")
    });
  }

  destroy() {
    const c = this.child;
    this.child = null;
    if (!c) return;
    try { c.stdin.end(); } catch (_) {}
    try { c.kill("SIGKILL"); } catch (_) {}
  }

  /** 在持久 shell 里执行一条命令（不做排队，调用方需自行串行化）。 */
  raw(command, timeoutMs) {
    const self = this;
    return new Promise(function (resolve) {
      if (!self.child || !self.child.stdin || !self.child.stdin.writable) {
        resolve({ ok: false, exit_code: -1, stdout: "", stderr: "", error: "root shell 不可用" });
        return;
      }
      const token = "__DSHRC_" + (++self.seq) + "_" + Math.random().toString(36).slice(2, 10) + "__";
      const limit = Math.max(1000, Math.min(timeoutMs || 60000, MAX_TIMEOUT));
      const entry = { token: token, out: "", err: "", resolve: resolve, timer: null };
      self.pending = entry;
      entry.timer = setTimeout(function () {
        if (self.pending === entry) self.pending = null;
        self.destroy();
        resolve({
          ok: false,
          exit_code: -1,
          stdout: entry.out.trim().slice(0, MAX_STDOUT),
          stderr: entry.err.trim().slice(0, MAX_STDERR),
          error: "root 命令超时（" + limit + "ms），已重启 root shell"
        });
      }, limit);

      // { ... } </dev/null : 让命令无法吞掉 root shell 自身的脚本输入（否则 cat/read 会挂死）。
      // printf 哨兵带上 $?，用于精确切分输出与退出码。
      const script =
        "{\n" + command + "\n} </dev/null\n" +
        "__dshrc=$?\n" +
        "printf '" + token + "%s\\n' \"$__dshrc\"\n";
      try {
        self.child.stdin.write(script);
      } catch (e) {
        clearTimeout(entry.timer);
        if (self.pending === entry) self.pending = null;
        self.destroy();
        resolve({ ok: false, exit_code: -1, stdout: "", stderr: "", error: "写入 root shell 失败：" + String((e && e.message) || e) });
      }
    });
  }

  /** 串行执行：同一时刻只允许一条命令，避免输出串帧。 */
  exec(command, timeoutMs) {
    const self = this;
    const run = async function () {
      const now = Date.now();
      if (!self.startFailedAt || now - self.startFailedAt > 300000) {
        try {
          await self.ensure();
          return self.raw(command, timeoutMs);
        } catch (e) {
          self.startFailedAt = now;
          self.lastStartError = String((e && e.message) || e);
        }
      }
      // 持久化不可用（su 不支持无参交互 shell）→ 回退一次性 su -c，功能不丢。
      const r = await once(self.bin, ["-c", command], timeoutMs);
      if (!r.error) r.error = "持久 root shell 不可用（" + (self.lastStartError || "未知原因") +
        "），当前使用一次性 su 模式：命令之间的 cd/环境变量不会保留。";
      return r;
    };
    const next = this.queue.then(run, run);
    this.queue = next.then(function () {}, function () {});
    return next;
  }
}

let shellInstance = null;

/** 以 root 执行一条 shell 命令（对外主入口）。 */
export async function rootExec(command, timeoutMs) {
  const su = await resolveSuPath();
  if (!su) {
    return {
      ok: false,
      exit_code: -1,
      stdout: "",
      stderr: "",
      error: "未找到可用的 su，root 通道不可用（已尝试：" + SU_CANDIDATES.join(", ") + "）"
    };
  }
  if (!shellInstance || shellInstance.bin !== su.bin) {
    if (shellInstance) shellInstance.destroy();
    shellInstance = new RootShell(su.bin);
  }
  return shellInstance.exec(command, timeoutMs);
}

/** root 通道状态（供 shizuku_status 展示）。 */
export async function rootStatus() {
  const su = await resolveSuPath();
  if (!su) {
    return { available: false, candidates: SU_CANDIDATES.slice(), detail: "未找到可用的 su" };
  }
  return {
    available: true,
    su: su.bin,
    id: su.id,
    persistent: !!(shellInstance && shellInstance.child),
    candidates: SU_CANDIDATES.slice()
  };
}

/** 释放持久 shell（配置重载 / 排查问题时用）。 */
export function resetRootShell() {
  if (shellInstance) shellInstance.destroy();
  shellInstance = null;
  suProbe = null;
  resolvedSu = null;
}
