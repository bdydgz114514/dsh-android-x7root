/**
 * 定制版 root 专属工具集
 *
 * 补齐官方 v1.7.5 的三个空白：
 *   - root_read_file / root_write_file ：以 root 身份读写**任意路径**
 *     （/data/data/<pkg>/、/data/system/、/data/adb/ 等 app uid 永远读不到的地方），
 *     分块 + base64，二进制安全。
 *   - android_device_probe ：一次性体检（机型/ColorOS 版本/root 方案/SELinux/电量/存储/屏幕）。
 *   - android_optimize_keepalive ：Oppo/ColorOS 后台保活加固（Doze 白名单 + 后台运行 appop
 *     + 活跃待机桶），让长时间 AI 任务在锁屏/切后台后不被系统冻结。
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { rootExec, rootStatus, shellQuote, fileReadCommand, fileWriteCommands } from "./root-shell.js";

const MAX_WRITE_BYTES = 8 * 1024 * 1024;

function fail(r) {
  return (r && (r.error || r.stderr)) || "未知错误";
}

function selfPackage() {
  return process.env.SHIZUKU_APP_ID || "com.deepseek.harness";
}

/** 分块读取文件（base64），避免一次拉爆工具输出上限。 */
async function readChunk(path, offset, length) {
  return rootExec(fileReadCommand(path, offset, length), 120000);
}

export function registerRootTools(ctx) {
  // ---------------- root_read_file ----------------
  ctx.tools.register(defineTool({
    name: "root_read_file",
    description:
      "以 **root 身份**读取手机上任意路径的文件（app 自身权限读不到的地方也读得到，例如 /data/data/<包名>/、/data/system/、/data/adb/、/data/misc/）。" +
      "分块读取：大文件用 offset + length 分多次读。as=text（默认）按 UTF-8 返回文本；as=base64 返回原始字节（读二进制文件/图片时用）。" +
      "只需要普通文件读取时优先用 fs 工具，只有普通权限被拒（Permission denied）时才用本工具。",
    parameters: {
      path: { type: "string", required: true, description: "绝对路径，例如 /data/data/com.tencent.mm/shared_prefs/xxx.xml" },
      offset: { type: "number", description: "起始字节偏移，默认 0。" },
      length: { type: "number", description: "读取字节数，默认 16384，最大 262144。" },
      as: { type: "string", description: "text（默认，UTF-8 文本）或 base64（原始字节）。" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          path: { type: "string" },
          size: { type: "number" },
          offset: { type: "number" },
          bytes: { type: "number" },
          eof: { type: "boolean" },
          content: { type: "string" },
          error: { type: "string" }
        }
      },
      render: function (_args, v) {
        if (!v.ok) return [{ type: "text", text: "读取失败：" + (v.error || "未知错误") }];
        return [{
          type: "text",
          text: "文件 " + v.path + "（总 " + v.size + " 字节，本次读 " + v.bytes + " 字节，offset=" + v.offset +
            (v.eof ? "，已到文件尾" : "，还有后续内容") + "）：\n\n" + v.content
        }];
      }
    },
    async execute(args) {
      const path = String(args.path || "");
      if (!path) return { ok: false, error: "path 不能为空" };
      const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
      const length = Math.max(1, Math.min(Math.floor(Number(args.length) || 16384), 262144));
      const as = args.as === "base64" ? "base64" : "text";

      const q = shellQuote(path);
      const st = await rootExec("stat -c %s " + q + " 2>/dev/null || echo -1", 30000);
      const size = parseInt(String(st.stdout || "").trim(), 10);
      if (!Number.isFinite(size) || size < 0) {
        return { ok: false, path: path, error: "无法读取文件（不存在或权限不足）：" + (st.stderr || st.error || "").trim() };
      }

      const r = await readChunk(path, offset, length);
      if (!r.ok) return { ok: false, path: path, size: size, error: fail(r) };

      let data;
      try {
        data = Buffer.from(String(r.stdout || "").trim(), "base64");
      } catch (e) {
        return { ok: false, path: path, size: size, error: "base64 解码失败：" + String((e && e.message) || e) };
      }
      return {
        ok: true,
        path: path,
        size: size,
        offset: offset,
        bytes: data.length,
        eof: offset + data.length >= size,
        content: as === "base64" ? data.toString("base64") : data.toString("utf8")
      };
    }
  }));

  // ---------------- root_write_file ----------------
  ctx.tools.register(defineTool({
    name: "root_write_file",
    description:
      "以 **root 身份**写入手机上任意路径的文件（可覆盖系统/应用私有目录下的文件，例如 /data/data/<包名>/shared_prefs/、/data/local/tmp/、/data/adb/）。" +
      "分块 base64 写入，二进制安全；可选 mode 设置权限（如 644 / 755）。" +
      "危险操作：覆盖系统文件前请先备份（可先用 root_read_file 读出原内容）。",
    parameters: {
      path: { type: "string", required: true, description: "绝对路径。" },
      content: { type: "string", required: true, description: "要写入的内容（文本或 base64）。" },
      encoding: { type: "string", description: "utf8（默认）或 base64。" },
      mode: { type: "string", description: "可选，八进制权限，例如 644、755。" },
      append: { type: "boolean", description: "为 true 时追加而不覆盖，默认 false。" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          path: { type: "string" },
          bytes: { type: "number" },
          size: { type: "number" },
          error: { type: "string" }
        }
      },
      render: function (_args, v) {
        return [{
          type: "text",
          text: v.ok
            ? "已写入 " + v.path + "（" + v.bytes + " 字节，当前文件大小 " + v.size + "）✅"
            : "写入失败：" + (v.error || "未知错误")
        }];
      }
    },
    async execute(args) {
      const path = String(args.path || "");
      if (!path) return { ok: false, error: "path 不能为空" };
      let buf;
      try {
        buf = Buffer.from(String(args.content == null ? "" : args.content), args.encoding === "base64" ? "base64" : "utf8");
      } catch (e) {
        return { ok: false, error: "内容编码失败：" + String((e && e.message) || e) };
      }
      if (buf.length > MAX_WRITE_BYTES) {
        return { ok: false, error: "内容过大（" + buf.length + " 字节），上限 " + MAX_WRITE_BYTES + " 字节" };
      }

      const q = shellQuote(path);
      const b64 = buf.toString("base64");
      const cmd = fileWriteCommands(path, b64, !!args.append, args.mode).join("\n") + "\n";

      const r = await rootExec(cmd, 300000);
      const st = await rootExec("stat -c %s " + q + " 2>/dev/null || echo -1", 30000);
      const size = parseInt(String(st.stdout || "").trim(), 10);
      const out = { ok: !!r.ok, path: path, bytes: buf.length, size: Number.isFinite(size) ? size : -1 };
      if (!r.ok) out.error = fail(r);
      return out;
    }
  }));

  // ---------------- android_device_probe ----------------
  ctx.tools.register(defineTool({
    name: "android_device_probe",
    description:
      "设备体检（需要 root）：一次性返回机型、厂商、ColorOS/Android 版本、root 方案与 su 路径、SELinux、内核、ABI、电量/温度、存储、屏幕分辨率与密度。" +
      "在执行任何机型相关的自动化前先调用一次，据此选择正确的命令与路径。",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          report: { type: "string" },
          su: { type: "string" },
          error: { type: "string" }
        }
      },
      render: function (_args, v) {
        return [{ type: "text", text: v.ok ? v.report : "体检失败：" + (v.error || "未知错误") }];
      }
    },
    async execute() {
      const cmd = [
        "echo '--- 机型 ---'",
        "echo brand=$(getprop ro.product.brand) model=$(getprop ro.product.model) device=$(getprop ro.product.device)",
        "echo market=$(getprop ro.vendor.oplus.market.name)$(getprop ro.product.marketname)",
        "echo '--- 系统 ---'",
        "echo android=$(getprop ro.build.version.release) sdk=$(getprop ro.build.version.sdk)",
        "echo build=$(getprop ro.build.display.id)",
        "echo oplusrom=$(getprop ro.build.version.oplusrom)$(getprop ro.oplus.version)$(getprop ro.build.oplus_nv_id)",
        "echo '--- root ---'",
        "id",
        "echo su=$(command -v su 2>/dev/null)",
        "ls -l /system/bin/su /system/xbin/su /data/adb/magisk/su /data/adb/ksu/bin/su 2>/dev/null",
        "echo magisk=$(magisk -V 2>/dev/null)$(magisk -v 2>/dev/null)",
        "echo selinux=$(getenforce 2>/dev/null)",
        "echo '--- 内核/ABI ---'",
        "uname -a",
        "echo abi=$(getprop ro.product.cpu.abi)",
        "echo '--- 电量 ---'",
        "dumpsys battery 2>/dev/null | grep -Ei 'level|status|temperature|health|powered' ",
        "echo '--- 存储 ---'",
        "df -h /data /sdcard 2>/dev/null",
        "echo '--- 屏幕 ---'",
        "wm size 2>/dev/null; wm density 2>/dev/null",
        "echo '--- 内存 ---'",
        "head -3 /proc/meminfo"
      ].join("\n");
      const r = await rootExec(cmd, 90000);
      if (!r.ok) return { ok: false, error: fail(r) };
      const st = await rootStatus();
      return { ok: true, report: r.stdout, su: st.available ? st.su : "(不可用)" };
    }
  }));

  // ---------------- android_optimize_keepalive ----------------
  ctx.tools.register(defineTool({
    name: "android_optimize_keepalive",
    description:
      "Oppo/ColorOS 后台保活加固（需要 root）：把本应用（以及可选的 Shizuku）加入 Doze 白名单、" +
      "放开后台运行 appop、设为活跃待机桶，降低锁屏/切后台后被 ColorOS 冻结或杀掉导致 AI 任务中断的概率。" +
      "执行后返回每条命令的结果；ColorOS 仍有个别开关（自启动/关联启动/省电策略）需要在系统设置里手动确认。",
    parameters: {
      package_name: { type: "string", description: "要加固的包名，默认本应用（com.deepseek.harness）。" },
      include_shizuku: { type: "boolean", description: "是否同时加固 Shizuku（moe.shizuku.privileged.api），默认 true。" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          report: { type: "string" },
          error: { type: "string" }
        }
      },
      render: function (_args, v) {
        return [{ type: "text", text: v.ok ? v.report : "加固失败：" + (v.error || "未知错误") }];
      }
    },
    async execute(args) {
      const pkg = String(args.package_name || selfPackage());
      const targets = [pkg];
      if (args.include_shizuku !== false) targets.push("moe.shizuku.privileged.api");

      const lines = [];
      for (const p of targets) {
        lines.push("echo '### " + p + "'");
        lines.push("dumpsys deviceidle whitelist +" + p + " 2>&1");
        lines.push("cmd appops set " + p + " RUN_IN_BACKGROUND allow 2>&1");
        lines.push("cmd appops set " + p + " RUN_ANY_IN_BACKGROUND allow 2>&1");
        lines.push("am set-standby-bucket " + p + " active 2>&1");
        lines.push("cmd appops get " + p + " RUN_IN_BACKGROUND 2>&1");
      }
      lines.push("echo '### 当前白名单'");
      lines.push("dumpsys deviceidle whitelist 2>/dev/null | head -20");

      const r = await rootExec(lines.join("\n"), 120000);
      const report = (r.stdout || "") + (r.stderr ? "\n[stderr]\n" + r.stderr : "");
      return {
        ok: true,
        report:
          "后台保活加固结果：\n\n" + report +
          "\n\n仍需在 ColorOS 设置里手动确认：\n" +
          "1) 设置 → 应用 → 应用管理 → DeepSeek Harness → 耗电管理：允许后台活动 / 允许自启动 / 允许关联启动\n" +
          "2) 设置 → 电池 → 更多设置：关闭「智能省电」对本应用的优化\n" +
          "3) 最近任务里下拉本应用卡片 → 加锁（防止一键清理）\n"
      };
    }
  }));
}
