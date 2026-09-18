# 变更记录（本分支）

> 上游基线的变更见 @CHANGES.md@。

## 1.7.5-x7root.8 (versionCode 116) — 内核升级到 0.1.6-alpha.2
- **修复「选工作区一闪就弹回」（真机截图复现 + 控制台定位）**：这不是工作区的问题，而是
  **任何会话都创建不了**。控制台原文：
  `session create failed: agent-preset/invalid: preset "standard" failed to mount: 2 row(s) did not activate:
  workflow-ptc … waiting for ptcRuntime / tool-workflow … waiting for workflowEngine`。
  根因：Android 配置里 `sandbox` 被禁用 → 0.1.6 的 `ptc-runtime` 注入 `sandbox`/`sandboxPolicy` 拿不到服务
  → `ptcRuntime` 不激活 → standard 预设的 `workflow-ptc`/`tool-workflow` 挂不上 → 预设挂载失败 → 会话创建失败。
  修复：**把 `sandbox` 改回启用**（由 `dsh-sandbox-local` 提供；默认权限是 `danger-full-access`，
  该模式下 ptc/bash 都不会调用 `confine()`，所以不需要内核级沙箱也能跑），
  `bash-sandbox` 保持禁用（它和 `bash-local` 抢注册 `shell` 服务会直接崩）。
  修复后引擎启动**零 pending 告警**，工作区选中并出现对勾。
- 构建链修一个坑：`prune-and-rebuild.sh` 之前只同步内核与 REVISION，**没有同步 dshhome 配置**，
  导致改了 `cordis.patch.yml` 重新打包却不生效（排查时被这个误导过）。现已一并同步。
- **启动提速（真机实测 20 秒 → 3.7 秒）**：以前**每次启动都重写 2 万+ 个内核文件**。
  根因是"完成标记缺失 → 一律全量补齐"的保守判断，叠加"内部运行时补齐"每次都要预扫整个 payload。
  改为：
  1. 用**上次成功同步时写下的构建号**（internal_rev / dshroot_synced_rev）判断是否需要再同步，
     APK 换新才重新同步，同一份 APK 的第 2 次起直接跳过（省掉 6.2 秒全量 + 2.3 秒内核扫描）；
  2. 完成标记缺失时改为**先比对已就位内核 package.json 的 version**，同版本就不再全量重写。
  实测：引擎就绪 20s → **3.7s**（连续 3 次稳定）。
- **AI 工作区修复**：
  - 设置页「定制」标签**新增「AI 工作区」行**（原来只在"首次使用"权限页里，装完就再也找不到），
    显示当前路径与可用状态，提供「选择文件夹」「用默认目录」；
  - Android 11+ 没有「所有文件访问」时，系统文件夹选择器会直接提示"无法使用此文件夹"——
    现在点「选择文件夹」会**先给授权引导**，授权后再选；
  - 选到不可写的目录时不再静默失败：会给出「去授权 / 用默认目录」的补救选项；
  - 默认目录按「公共目录 → 应用专属外部目录 → 内部目录」取第一个真正可写的，
    实测落到 `/sdcard/DeepSeekHarness/workspace`（与知识库同处，卸载重装不丢）。
- **真机实测（vivo V2452A / Funtouch OS 16 / Android 16 / arm64-v8a）发现并修复 2 个启动阻塞**：
  1. `node-addon-require-builtin@0.1.6` **没有 android-arm64 构建**（可选包只覆盖
     darwin / linux-glibc / win32），`dsh-app-boot` 加载期即抛
     "No usable native binding found for node-addon-require-builtin-android-arm64" → 引擎起不来。
     修复：`dsh-app-boot` 的 `internalModules()` 改为**优先用 `--expose-internals` 直接 require
     内部模块**（应用本来就带该参数），原生插件退化为兜底。
  2. 0.1.6 新增**浏览器会话认证**：根路径无 token 返回 401
     （"dsh web authentication required"）。App 的 `isDshEngine()` 探测与 WebView 都请求
     `/`，导致健康检查永远失败、界面停在"正在启动…"。
     修复：App 从引擎 stdout 捕获启动时打印的 `?token=`，用它做健康探测与首次 WebView 加载；
     探测识别 **303 token 交换**即判定引擎存活（`HttpURLConnection` 不保存 Cookie，跟随重定向反而拿到 401）。
- **内核从 `0.1.5-rc.2` 升级到 `0.1.6-alpha.2`**（依赖树 83 个包；新增
  `dsh-hmr` / `dsh-plugin-manager` / `dsh-atomic-write` / `dsh-mcp-resources` / `dsh-workflow-ptc` 等）。
- **Android 源码补丁按新内核重新移植**（不再直接套用 0.1.0-rc.6 时代的旧文件），
  见 @dsh-patches/README.md@：
  - `dsh-subprocess-local`：node-pty → `spawnPtyCompat`（child_process 模拟）；
    `@deepseek-ai/dsh-win32-process` 改为按需 `createRequire` 加载（koffi 原生绑定在 Android 不可用）。
  - `dsh-attachment-local`：sharp/libvips → 纯 JS 图片头解析（PNG/JPEG/WEBP/GIF）；
    图片规范化改为字节透传；`link()` → 独占复制回退；目录 fsync 在 EACCES/EPERM 时降级为 best-effort。
  - `dsh-bash-local`：补回 `sandboxMode` getter（原生沙箱已禁用）。
  - `dsh-session-persistence-jsonl`：硬链接 → `rename()` / 独占复制（Android SELinux 禁 `link()`）。
- 内核包体积治理：剔除 Windows 专用原生包（`libreoffice-kit-win32-x64` 325 MB、`@img/sharp-*`、
  `node-pty` 预编译产物）与开发期文件（`*.map` / `*.d.ts` / docs，约 236 MB），
  否则打包会因体积超限失败。
- `ptc-runtime` 在 Android 上等待已禁用的 `sandbox` 服务，启动时有一条 pending 告警（不影响使用）。

## 1.7.5-x7root.7 (versionCode 115) — OEM 保活自动识别 + 插件文件补全
- `android_optimize_keepalive` 不再只针对 ColorOS：新增厂商 ROM 识别
  （MIUI/HyperOS、ColorOS/realme/OnePlus、EMUI/HarmonyOS/MagicOS、One UI、OriginOS/Funtouch、Flyme、通用 Android），
  返回该 ROM 对应的手动开关清单（自启动、省电策略、后台限制、最近任务加锁等）。
- 修复开源仓库中 `dsh-tool-shizuku` 缺失 `root-shell.js` / `root-tools.js` 的问题（否则插件加载即失败）。

## 1.7.5-x7root.6 (versionCode 114) — 兼容性修补
- 兼容性审计与修补，详见 @docs/兼容性与机型适配.md@：
  - su 候选路径补充 APatch（@@/data/adb/ap/bin/su@ 等@）；
  - 知识库目录三级降级（公共外部 → 应用专属外部 → 内部），未授予「所有文件访问」也能用；
  - WebView API 补齐扩展到 @@structuredClone / Object.hasOwn / at / replaceAll / findLast / toSorted / Promise.any / groupBy / Set 运算 / AbortSignal.timeout@；
  - 清单声明 @@FOREGROUND_SERVICE_DATA_SYNC@（面向 Android 14+）。

## 1.7.5-x7root.5 (versionCode 113) — 设置并入 DSH 内置 UI
- 新增客户端插件 @@dsh-client-ui-settings-custom@：在 DSH 设置里增加「定制」标签页
  （运行模式 / 知识库 / 检查更新 / 关于），使用 DSH 原生样式与槽位机制。
- 新增 @@DSHNative@ 原生桥（@@addJavascriptInterface@）并限制 WebView 只加载本地页面。
- 移除右上角独立的「设置」按钮。

## 1.7.5-x7root.4 (versionCode 111) — 运行模式与知识库
- 有 root / 无 root 运行模式（@@DSH_RUN_MODE@ / @@ROOT_AVAILABLE@ 注入引擎）。
- 知识库迁到外部存储（@@DSH_KNOWLEDGE_DIR@），覆盖安装/重装不丢；自动迁移旧数据。
- 取消启动时自动检查更新（保留手动入口）。
- 修复看门狗在切换模式时重复拉起引擎（@@engineRestarting@）。
- 知识库同名条目改为覆盖更新（避免自动整理产生重复）。

## 1.7.5-x7root.3 (versionCode 109) — 能力扩展
- 内置 Office 工具（@@office_read/write/edit/info/convert@，全本地库）。
- 无障碍触控扩展：新增 @@android_find@ 与 @@android_gesture_preset@。
- WebView 文件上传（原生选择器 + 相机）。
- 知识库插件（SQLite FTS5）与每轮自动整理入库。

## 1.7.5-x7root.2 (versionCode 106–108) — 内核升级
- 内核升级到 @@0.1.5-rc.2@，含 Android 可移植性补丁（@@patches/patch-015.mjs@）。
- 注入 @@mobile-patch/webview-compat.js@ 修复旧 WebView 上 @@Iterator is not defined@。
- 修复 @@flock is not supported on android-arm64@。

## 1.7.5-x7root.1 — 起点
- 基于上游 App，切换为新的签名密钥与自定义构建链。
