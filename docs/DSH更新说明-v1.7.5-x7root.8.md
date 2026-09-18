# DSH 定制版 · 更新说明（v1.7.5-x7root.8）

> 内核：`@deepseek-ai/dsh@0.1.6-alpha.2`（**从 0.1.5-rc.2 升级**）
> 产物：`DeepSeekHarness-X7Root-v1.7.5-x7root.8.apk`
> 包名 `com.deepseek.harness`　versionCode `116`　versionName `1.7.5-x7root.8`　targetSdk `28`
> 大小 164,828,168 字节　SHA-256 `ccd4ae2cbb80037d1582cc7a28f747abefec46f46b192c4e77f4d0ccfc222a15`

本版是**内核升级版**：把内嵌的 DSH 内核从 `0.1.5-rc.2` 换到 npm 上最新的 `0.1.6-alpha.2`，
并把 4 个 Android 适配补丁按新内核源码**重新移植**（不是套用旧文件）。
功能面与 x7root.7 一致（Office / 无障碍触控 / 知识库 / 文件上传 / 定制设置页 / OEM 保活识别全部保留）。

## 内核升级内容

新内核依赖树 83 个包（旧版 79 个），新增 `dsh-hmr`、`dsh-plugin-manager`、`dsh-atomic-write`、
`dsh-mcp-resources`、`dsh-workflow-ptc`、`dsh-lazy-require`、`dsh-session-query-sqlite` 等，
并新增 `ptc`（代码运行时）、插件管理界面、终端侧栏等能力。

## Android 适配补丁移植

| 包 | 旧版做法（0.1.0-rc.6 时代文件） | 本版做法（针对 0.1.6-alpha.2 源码） |
|---|---|---|
| `dsh-subprocess-local` | 顶层 `import * as nodePty` + 手写 shim | 仍用 `spawnPtyCompat`，但 `dsh-win32-process`（koffi 原生绑定）改 `createRequire` 惰性加载 |
| `dsh-attachment-local` | 直接套用旧文件（会回退上游新逻辑） | 基于 0.1.6 源码：sharp → 纯 JS 头解析（PNG/JPEG/WEBP/GIF）、规范化字节透传、`link()` → 独占复制、目录 fsync EACCES 降级 |
| `dsh-bash-local` | 补 `sandboxMode` getter | 同（新源码结构未变） |
| `dsh-session-persistence-jsonl` | `link()` → `rename()` | 同，并补 `linkOrCopyExclusive` 回退 |

> 0.1.6 新增了 `dsh-lazy-require`：`sharp` / `node-pty` 已由上游改成「首次使用时才 require」，
> 所以顶层 import 不再会拖垮模块加载；补丁只需保证调用点走兼容实现。

## 体积治理

新内核照原样打包会让 payload 膨胀到 216 MB（APK 226 MB）。本版做了两件事：

1. **剔除平台不匹配的原生包**：`libreoffice-kit-win32-x64`（325 MB，Windows 专用）、
   `@img/sharp-*`（18.6 MB）、`node-pty`（26.8 MB）、`@vscode/ripgrep`（Android 用 `runtime/bin/rg`）。
2. **剔除开发期文件**：`*.map`（127 MB）、`*.d.ts`（70 MB）、docs/tests（约 39 MB），合计 236 MB。

结果：payload 216 MB → 157 MB，APK 226 MB → 157 MB。
代价说明：**Office 文档转 PDF（`dsh-office-to-pdf`）在 Android 上不可用**（LibreOffice 无 Android/arm64 构建），
调用时会返回 `unavailable`；Office 的读写/编辑/信息等能力不受影响。

## 真机实测（vivo V2452A / Funtouch OS 16 / Android 16）

在 **vivo V2452A（Android 16 / API 36 / arm64-v8a / WebView 138 / 无 root 无 Shizuku）** 上完成安装与运行验证：

| 项 | 结果 |
|---|---|
| Android 16 上安装（targetSdk 28） | 通过 |
| 首次启动解压 payload | 21,665 个内核文件，约 20 秒 |
| 引擎进程 + 3080 服务 | 通过（无 token 401 / 带 token 303+Set-Cookie / 带 Cookie 200） |
| WebView 渲染 DSH 界面 | 通过（截图见 `docs/screenshots/x8-device-vivo-android16.png`） |
| 移动端适配 mobile.css/js | 均 200，引用已注入 |
| 定制设置页客户端插件 | 已在前端 plugin 列表 |
| 插件 import 失败 / crash.log | 无 |

**真机测出并修复了 2 个启动阻塞**（这正是"没连真机"时看不出来的问题）：

1. `node-addon-require-builtin@0.1.6` **没有 android-arm64 构建**（上游可选包只有 darwin / linux-glibc / win32），
   内核加载期直接抛 `No usable native binding found for node-addon-require-builtin-android-arm64`，引擎起不来。
   → 修复：`dsh-app-boot` 改为优先用 node 自带的 `--expose-internals` 直接 require 内部模块，原生插件退化为兜底。
2. 0.1.6 新增**浏览器会话认证**：根路径无 token 返回 401，App 原来的健康探测与 WebView 都请求 `/`，
   结果引擎已就绪却永远停在"正在启动…"。
   → 修复：App 从引擎 stdout 捕获 `?token=`，用它做健康探测与首次 WebView 加载；
   探测识别 **303 token 交换**即判定引擎存活（`HttpURLConnection` 不保存 Cookie，跟随后反而得 401）。

**仍未验证**：端到端真实对话（本机未配置 API Key）。

## 静态验证（本机可复现）

| # | 验证项 | 方式 | 结果 |
|---|---|---|---|
| 1 | 4 个补丁包语法正确 | `node --check` | 4/4 通过 |
| 2 | Android 兼容符号已写入补丁源码 | 断言 `spawnPtyCompat` / `probeImageBytes` / `linkOrCopyExclusive` / `sandboxMode` / `rename` | 9/9 存在 |
| 3 | 原生依赖不再在顶层 import | 扫描文件头 | 通过 |
| 4 | 纯 JS 图片头解析器正确性 | PNG/JPEG/WEBP/GIF/随机字节 5 组样例 | 5/5 与预期一致 |
| 5 | 硬链接回退语义 | `link()` 抛 EPERM / EEXIST 两种注入 | EPERM 走复制、EEXIST 直接抛出 |
| 6 | 6 个定制插件依赖登记 | 读内核 package.json | 6/6 登记 |
| 7 | 引擎可启动并服务 HTTP | 本地 node 启动 `dsh web`，带 token 取首页 | HTTP 200 / 27666 字节 |
| 8 | 成品 APK 内含新内核 | 解包读 `assets/dshroot_kernel_version.txt` | `0.1.6-alpha.2` |
| 9 | 成品 APK 内含移植后的补丁 | 从 payload.zip 取出断言 | 10/10 通过 |
| 10 | 成品 APK 无 API Key 泄漏 | 正则扫 `sk-[A-Za-z0-9]{20,}` | 无 |
| 11 | 覆盖安装升级可用性 | 用旧 0.1.5-rc.2 树 + App 的 skipIfExists/白名单合并逻辑模拟升级 | 合并后引擎**启动成功**、HTTP 200、mobile.css/js 可取（200） |
| 12 | 合并后依赖完整性 | 按新内核 package.json 逐项检查 | 83/83 齐全 |
| 13 | 签名与包信息 | `apksigner verify` / `aapt dump badging` | 签名证书与上一版一致；versionCode 116 / versionName 1.7.5-x7root.8 |
| 14 | 真机运行时 | — | **未做**（设备未连接；上一版 x7root.5 曾在 Android 14 / ColorOS / KernelSU 实测通过） |

自动复现：`node test-port-016.mjs`（34 项，见仓库 `tests/`）。

## 已知问题

- 启动时有一条 `ptc-runtime ... pending (waiting for service: sandbox)` 告警：
  Android 上 `sandbox` 被禁用（依赖无法编译的原生模块），PTC 代码运行时因此不激活。不影响其它功能。
- 覆盖安装升级验证是**静态合并模拟**，不是在真机上跑完整安装流程；外部 dshroot 里的旧包文件不会被删除
  （App 的既有策略：只补缺失文件 + 覆盖白名单），合并后的混合树已验证能启动。

## 无法在软件层解决的

- **32 位(armeabi-v7a) / x86 设备**：运行时是 `android-arm64`，需自行替换。
- **Android 15+ 的 16 KB 页大小机型**：需按 16 KB 对齐重新编译原生运行时。
- **Office 转 PDF**：LibreOffice 无 Android 构建，本版无此能力。
- **厂商私有后台开关**（MIUI/HyperOS、EMUI、OneUI 等）：App 无法代开，只能引导用户手动设置。