# DeepSeek Harness 安卓定制版（X7Root）

把 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）跑在 Android 手机上的**增强分支**：
升级到 0.1.6-alpha.2 内核，内置 Office 文档处理、无障碍触控、知识库与文件上传，并把 App 自有设置**并入 DSH 自带设置界面**。

> 上游项目：[woaiys3/deepseek-harness-android-app](https://github.com/woaiys3/deepseek-harness-android-app)（MIT）
> 内核：`@deepseek-ai/dsh@0.1.6-alpha.2`
> 本分支：`1.7.5-x7root.8`（versionCode 116）

## 特性

| 能力 | 说明 |
|---|---|
| 内核升级 | 0.1.6-alpha.2，含 Android 端可移植性补丁（见 `dsh-patches/`；`patches/patch-015.mjs` 是 0.1.5-rc.2 时代的移植记录） |
| 运行模式 | **有 root / 无 root** 一键切换（设置里切换，重启引擎生效） |
| 知识库 | 自动把每轮排障经验入库；SQLite FTS5 全文检索；存放在外部存储，**更新/重装不丢** |
| Office | 内置 `office_read/write/edit/info/convert`，支持 docx/xlsx/pptx/pdf 等，全部本地库实现 |
| 触控 | 无障碍服务模拟点击/滑动/输入/截图，含 `android_find` 定位元素与手势预设 |
| 文件上传 | WebView 原生文件选择器 + 相机，支持相册/文件/拍照 |
| 设置并入 UI | App 设置作为 **DSH 设置页的「定制」标签**，风格与原生一致；右上角不再有独立设置按钮 |
| 无自动更新 | 启动不再联网检查版本，改为设置里手动检查 |

> **真机实测**：v1.7.5-x7root.8（内核 0.1.6-alpha.2）已在
> **vivo V2452A / Funtouch OS 16 / Android 16 / arm64-v8a** 上完成安装与运行验证
> （引擎起来、界面渲染、移动端适配生效）；截图见 `docs/screenshots/x8-device-vivo-android16.png`，
> 明细见 `docs/验证记录.md`。

## 安装

1. 到 [Releases](../../releases) 下载 `DeepSeekHarness-X7Root-v*.apk`。
2. 手机需为 **arm64-v8a**、Android 7.0+（推荐 10+）。
3. 首次启动按引导授予：存储/所有文件访问、通知、无障碍、悬浮窗；root 或 Shizuku 可选。

> 因体积（约 139 MB）超过 GitHub 单文件 100 MB 限制，APK 只作为 **Release 资源**提供，不放在仓库里。

## 自行构建

仓库不含任何二进制（node 运行时、内核 payload、签名密钥）。完整构建需要：

1. 上游仓库：`git clone https://github.com/woaiys3/deepseek-harness-android-app`
2. DSH 内核 `@deepseek-ai/dsh@0.1.6-alpha.2` 及其依赖闭包
3. Android SDK：`android.jar` (API 34)、`aapt`、`d8`、`zipalign`、`apksigner`
4. 你自己的签名密钥（**仓库不提供**，请勿使用他人密钥）：
   ```bash
   keytool -genkeypair -keystore release.jks -alias dsh -keyalg RSA -keysize 2048 -validity 10000
   ```
5. 打补丁：`node patches/patch-015.mjs <dsh-root>`；把 `plugins/*` 放入 `<dsh-root>/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`
6. 编译 APK：`cd android-app && DSH_DEV_HOME=<你的 dsh 根> KEYSTORE_PASS=<你的口令> bash build.sh`

详细流程见 `android-app/README.md` 与 `docs/开发指南.md`。

## 目录结构

```
android-app/                 App 源码（Java）、清单、构建脚本
android-app-fix/             上游的修复模块
mobile-patch/                注入前端 WebView 的 mobile.js（键盘适配 + WebView API 补齐）与 webview-compat.js
plugins/                     随包发布的 DSH 插件（office / knowledge / accessibility / android / shizuku / 定制设置页）
dsh-patches/overlay/         对 DSH 内核包的可移植性覆盖（bash-local / session-persistence / subprocess-local / attachment-local 等）
patches/patch-015.mjs        0.1.5-rc.2 的 Android 端可复现移植脚本
docs/                        各版本更新说明、开发指南、兼容性分析
```

## 兼容性

见 `docs/兼容性与机型适配.md`：按 Android 版本、root 方案、厂商 ROM、WebView 版本逐项列出**预期问题 / 是否已修补 / 用户需做什么**。

已知无法在软件层解决的：32 位(armeabi-v7a)设备无法运行 arm64 node 运行时；Android 15+ 的 16 KB 页大小设备需要重新编译原生运行时。

## 已知限制

- PDF 写入仅支持 Latin-1 文本；docx 的 `office_edit` 只做文本替换。
- 「打开知识库目录」依赖系统里能接收 `resource/folder` 的文件管理器。
- 无 root 且未授权 Shizuku 时，AI 不能执行系统级操作（符合预期）。
- 旧版遗留的定时任务 RPC 在 0.1.5 上不可用。

## 致谢与许可

- 上游 App：[woaiys3/deepseek-harness-android-app](https://github.com/woaiys3/deepseek-harness-android-app)（MIT，见 `LICENSE`）
- DSH 内核：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）
- 其它第三方组件与许可见 `NOTICE.md`

本仓库的修改同样以 **MIT** 发布。**不包含**任何签名密钥、账号凭证或用户数据。

---

## English summary

A customized Android build of DeepSeek Harness (kernel `0.1.6-alpha.2`), forked from
[woaiys3/deepseek-harness-android-app](https://github.com/woaiys3/deepseek-harness-android-app) (MIT).
Adds: root/no-root run modes, an auto-curated knowledge base (SQLite FTS5), on-device Office document
tools, accessibility-based touch simulation, native file upload, and an app settings page contributed as a
native tab inside the DSH settings UI. APKs are published as Release assets (139 MB exceeds GitHub's
100 MB file limit). Licensed MIT; no signing keys or credentials are included.