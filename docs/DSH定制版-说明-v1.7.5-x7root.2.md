# DSH 定制版 · 内核升级说明（v1.7.5-x7root.2）

> 基线：上游 `woaiys3/deepseek-harness-android-app` **v1.7.5** 的 X7Root 定制版（x7root.1）
> 本次改动核心：**内置 DSH 内核 0.1.1-rc.2 → 0.1.5-rc.2**（npm 上最新发布版本）
> 产物：`DeepSeekHarness-X7Root-v1.7.5-x7root.2.apk`
> 包名：`com.deepseek.harness`　versionCode `106`　versionName `1.7.5-x7root.2`　targetSdk `28`（保持不变）

---

## 一、本次做了什么

在原有 X7Root 定制（持久 root shell、4 个 root 工具、无障碍白名单等）**全部保留**的前提下，
把内置的 `@deepseek-ai/dsh` 内核从 **0.1.1-rc.2** 升级到 **0.1.5-rc.2**，并重新打包 APK。

内核升级不是简单替换文件：0.1.5 的依赖图与内部实现变化很大，原来的 4 处 Android 适配补丁
必须**重新移植**，另外还发现并处理了一处会导致 App 完全不可用的新变化（见第二节）。

### 内核版本对照

| 项 | 旧（x7root.1） | 新（x7root.2） |
|---|---|---|
| `@deepseek-ai/dsh` | 0.1.1-rc.2 | **0.1.5-rc.2** |
| `@deepseek-ai/*` 包数量 | 约 60 个 | 约 239 个 |
| 前端 | dsh-web-frontend | dsh-web-frontend（新 UI，移动端适配已重新注入） |

---

## 二、移植过程中处理的关键问题

### 1. 浏览器访问令牌（0.1.5 新增，致命）

0.1.5 给 Web 服务加了**每进程随机令牌**：直接访问 `http://127.0.0.1:端口/` 会返回 **401**。
这会让 WebView 白屏、`isDshEngine()` 健康检查失败（干等 90 秒后报启动超时）、定时任务的
`/api/...` 调用 401。0.1.5 没有提供「关闭令牌」的配置项。

**处理方式（已与使用者确认）**：在引擎侧关闭令牌校验
（`dsh-client-connection` 的 `authorizeIndex` / `isAuthenticated` 直接放行），恢复 0.1.1 的行为。

- 服务只监听 `127.0.0.1`，风险面仅限本机；
- 旧版本来就没有该令牌，因此**没有产生新的暴露面**；
- 代价：本机其它 App 若知道端口可以访问本地 Web 界面（与旧版一致）。

### 2. node-pty 原生模块（Android 无法编译）

0.1.5 中 node-pty 的调用点、以及 Win32 进程表检查代码（依赖 koffi）被拆到了新的包/分块文件里：

- `dsh-subprocess-local/lib/index.js`：删除 `node-pty` 顶层导入，改用 `child_process` 实现的
  `spawnPtyCompat()`（提供 pid/onData/onExit/write/kill/resize，交互式 PTY 能力降级为 no-op）；
  把 `@deepseek-ai/dsh-win32-process`（依赖 koffi 原生模块）改为**延迟 require**，Android 上根本不会加载。
- `dsh-subprocess-local/lib/runner-launch-*.js`：删除整个 Windows 进程检查区（koffi + Win32 结构体），
  `koffi` 改为延迟加载（仅 Linux execve 路径用到）。

### 3. sharp 原生模块（Android 无法编译）

`dsh-attachment-local` 依赖 sharp 做图像解码/缩放/转码。0.1.5 中该文件结构已变，
补丁重新实现为**纯 JS 头解析**（PNG/JPEG/WebP/GIF 读取宽高与 alpha），并：

- 删除全部 sharp 调用与图像规范化/请求版本转码逻辑，改为**字节原样透传**；
- 硬链接（`link`）改为 `rename`，并新增 `linkOrCopyExclusive()` 回退（SELinux/文件系统可能拒绝硬链接）；
- 目录 fsync 遇到 `EACCES/EPERM` 时跳过，避免受限目录导致附件保存失败。

### 4. 另外两处小补丁

| 包 | 改动 |
|---|---|
| `dsh-bash-local` | 补 `get sandboxMode()`（返回 `workspace-write`），供权限预设使用 |
| `dsh-session-persistence-jsonl` | 会话日志发布由硬链接改为 `rename`；`publishCurrentExclusive` 改为 link + 独占复制 |

### 5. 自定义插件解析

0.1.5 通过「安装依赖闭包」在 `$DSH_HOME/profiles/node_modules` 建立软链接。
`dsh-tool-shizuku / dsh-tool-android / dsh-tool-accessibility` 必须声明进 dsh 的
`dependencies`，否则加载时报 `Cannot find package` 直接启动失败。本次已写入 manifest。

### 6. WebView 兼容（真机实测发现的新问题）

真机（Android 14 + 系统 WebView **117**）上，0.1.5 的浏览器端 bundle 使用了比 WebView 117 更新的 API，
导致客户端插件在「导入」阶段直接报错，整页显示：

> Failed to load plugins
> failed to import loader entry … (@deepseek-ai/dsh-client-ui-sidebar-documentpreview): Iterator is not defined

缺失的 API：`Iterator` helpers（Chromium 122+）、`Promise.withResolvers`（119+）、
`URL.parse`（126+）、`Symbol.dispose` / `Symbol.asyncDispose`（134+）。
这些无法在引擎侧修复，必须在 WebView 里补齐。

**处理方式**：在移动端适配脚本 `mobile.js` 最前面注入一段兼容层
（`mobile.js` 是普通 `<script>`，在 defer 的 module 之前执行），只在 API 缺失时补：
`Iterator` 及其 `map/filter/take/drop/flatMap/reduce/toArray/forEach/some/every/find/join/from/concat`、
`Promise.withResolvers`、`URL.parse`、`Symbol.dispose` / `Symbol.asyncDispose`。
现代 WebView（Chromium 122+）上为完全 no-op；共 16 项单测通过（在 Node 中手动移除这些 API 后验证）。

> 更彻底的做法是把系统 WebView 升级到最新
> （设置 → 应用 → 应用管理 → Android System WebView → 更新）。兼容层让你在 WebView 117 上也能正常用；
> 若日后又遇到别的更新 API，升级 WebView 是最省事的办法。

### 7. flock 不支持 android-arm64（真机跑任务时报错）

首次真正发消息时，引擎报：

> 本轮运行失败 flock is not supported on android-arm64

来源：`@deepseek-ai/node-addon-system/lib/flock.js` 只允许 `linux` / `darwin`
（Android 上 `process.platform === "android"`），也没有 Android 原生构建；
会话持久化 `dsh-session-persistence-jsonl` 用它做「会话跨进程写锁」，所以每次写会话都失败。

**处理方式**：Android 上让 `tryLockExclusive()` 直接返回成功。
这与上游自己的设计一致——其源码注释写明「browser worker 把原生 flock 桩成立即成功：它是单进程，
进程内写声明已排除所有写入者」。本 App 同样是单引擎进程。
（真机验证：`tryLockExclusive` 正常返回，随后的 `fstat` inode 校验也通过。）

同时确认了内置 node（**v26.4.0 / android-arm64**）的能力，无需额外补丁：
`node:sqlite`、`node:zlib` 的 zstd、`Iterator`、`Promise.withResolvers` 等均可用。

---

## 三、未改动 / 保留不变

- **持久化 root shell**、`root_read_file` / `root_write_file` / `android_device_probe` /
  `android_optimize_keepalive` 四个 root 工具：与 x7root.1 完全一致。
- su 多路径探测（`MainActivity.probeRoot()`）、无障碍插件强制覆盖白名单：不变。
- 移动端适配 `mobile.css` / `mobile.js`：已对 0.1.5 的新前端重新注入并验证可访问。
- `cordis.patch.yml` 的禁用项（`llm-pi-ai` / `sandbox` / `bash-sandbox` / `pwsh-sandbox` /
  `session-log-download`）与 `permission` 预设（`danger-full-access`，`approval: never`）：
  经 `--dump-config` 校验均生效。
- targetSdk 28（>=29 会让私有目录 noexec，node 起不来）：不变。

---

## 四、签名（重要）

本次按约定**生成了新的签名密钥**（无法获得原 `release.jks` 密码）：

| 项 | 值 |
|---|---|
| 文件 | `work/android-app/release.jks`（旧密钥备份为 `release-0.1.1.jks.bak`） |
| alias | `dsh` |
| 密码 | `dshX7Root015rc2` |
| 证书 | `CN=DSH Root Custom 0.1.5, OU=Android, O=DSH, L=Shenzhen, ST=Guangdong, C=CN`（RSA 2048） |
| SHA-256 指纹 | `F1:CA:0E:5A:E0:70:67:08:3C:37:5C:B5:AD:00:E7:70:92:35:E1:AE:48:BA:83:2F:A8:06:E4:4A:D3:87:ED:3C` |

> 与 x7root.1 的签名不同 → **必须卸载旧版再安装**。请妥善保存该密码，后续升级需继续使用。
> 构建命令：`cd work/android-app && DSH_DEV_HOME=... KEYSTORE_PASS=dshX7Root015rc2 sh build.sh`

---

## 五、安装步骤

1. **卸载旧的 DSH 定制版**（签名不同，无法覆盖安装）。卸载会清空 App 内部数据
   （API Key / 会话需重填），`/sdcard/DeepSeekHarness/` 下的 dshroot 会保留；
   新版启动时会检测到内核版本变化并**全量同步**，自动覆盖 shizuku / android / accessibility 等插件。
2. 安装 `DeepSeekHarness-X7Root-v1.7.5-x7root.2.apk`。
3. 打开 App，按权限引导页逐项授权，并授予 root。
4. 可选：系统设置 → 无障碍 → 开启屏幕助手。

---

## 六、已知限制与如实说明

1. **未做真机验证**：本机构建环境没有连接 Find X7（`adb devices` 为空）。
   已完成的验证见第七节；真机上首启、Magisk 授权、ColorOS 保活等仍需你实测。
2. **新签名**：必须卸载重装，API Key 与会话丢失。
3. **图像处理降级**：sharp/libvips 被移除，图片附件**不再自动压缩/转码**，直接以原字节存储与发送；
   超大图片仍受字节上限拦截（可能因此被拒绝）。
4. **交互式终端降级**：node-pty 被管道式 `child_process` 替代，`rows/cols/resize` 为 no-op；
   普通命令执行、输出、退出码正常。
5. **浏览器令牌已关闭**：见第二节第 1 点。
6. **定时任务的 API 兼容性**：`ScheduleExecutor` 直接调用 `/api/<method>`，0.1.5 的 API 若与
   0.1.1 有差异，定时任务可能失效（核心聊天/工具功能不受影响，未在真机验证）。

---

## 七、已做的验证（对升级后的内核，非源码）

在 Windows 上用 Node 直接启动升级后的引擎（并删除全部原生模块以模拟 Android）：

- 引擎成功启动并监听 `127.0.0.1`，首页返回 `200`、含 `<title>DeepSeek Harness</title>`；
- `--dump-config` 确认：4 个自定义插件条目与 `bash-local` 均已插入，5 个禁用项生效，
  `permission` 预设正确；
- 删除 sharp / node-pty / koffi 原生二进制后仍能启动（证明补丁把原生依赖真正摘除了）；
- 关闭令牌后，**不带 token** 访问首页返回 200（旧版行为）；
- 移动端适配 `mobile.css` / `mobile.js` 已注入且可被 HTTP 正常提供；
- 5 个被改写的 JS 文件均通过 `node --check` 语法校验。

- **真机验证（Android 14 / 系统 WebView 117）**：`adb install -r` 后启动，新 DSH 界面完整加载，
  不再出现「Failed to load plugins」，logcat 无 JS 报错。
- **真机验证（flock）**：用 `adb shell su` 跑 App 内置的 android-arm64 node，确认补丁后
  `tryLockExclusive` 正常返回、`node:sqlite`/zstd 可用。
- **真机端到端验证**：在手机上真实发消息后，`$DSH_HOME/sessions/…/session.v3.jsonl.zstd` 成功写入、
  运行状态显示 `1 轮 1 步 · 12.6K tok`，界面无红色失败提示。

**仍未验证**：Magisk 授权弹窗、ColorOS 后台保活、root 工具与无障碍的实际调用结果。

---

## 八、复现升级

```
upgrade/
  patch-015.mjs      # 对干净的 0.1.5-rc.2 npm 安装结果应用全部 Android 补丁
  build-apk.sh       # 调用 work/android-app/build.sh 打包
  pkg015/            # 下载的 0.1.5-rc.2 tgz 与解包对照
```

完整步骤：取出 `@deepseek-ai/dsh@0.1.5-rc.2` → `npm install --omit=dev`
（删除未发布的 devDependency `dsh-experimental-code-runtime-python`）→ 复制 3 个自定义插件并写入 manifest
→ 删除 sharp/node-pty/koffi 等原生包 → `node patch-015.mjs <dshroot/lib>` → `build.sh`。

> 说明：`upgrade/patch-015.mjs` 依赖原文精确匹配锚点，0.1.5-rc.2 之外的版本需重新适配。

---

## 九、产物校验

| 项 | 值 |
|---|---|
| 文件 | `DeepSeekHarness-X7Root-v1.7.5-x7root.2.apk` |
| 大小 | 123,204,616 字节 |
| SHA-256 | `7fdf07ad8835f420d9e99689ff05e23ef7c4206f060f857294d43741ac273502` |
| 包名 / versionCode / versionName | `com.deepseek.harness` / `106` / `1.7.5-x7root.2` |
| 内置内核 | `@deepseek-ai/dsh@0.1.5-rc.2` |
| 签名 | APK Signature Scheme v2 + v3 校验通过 |

