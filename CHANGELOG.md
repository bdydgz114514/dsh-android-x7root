# 变更记录（本分支）

> 上游基线的变更见 @CHANGES.md@。

## 1.7.5-x7root.8 (versionCode 116) — 内核升级到 0.1.6-alpha.2
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
