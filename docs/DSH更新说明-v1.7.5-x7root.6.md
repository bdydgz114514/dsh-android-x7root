# DSH 定制版 · 更新说明（v1.7.5-x7root.6）

> 内核：`@deepseek-ai/dsh@0.1.5-rc.2`（不变）
> 产物：`DeepSeekHarness-X7Root-v1.7.5-x7root.6.apk`
> 包名 `com.deepseek.harness`　versionCode `114`　versionName `1.7.5-x7root.6`　targetSdk `28`
> 大小 139,080,712 字节　SHA-256 `eb2c57cee52d8d621650183b559e92e1467db9eecbf8291a5a8c5cfa86cc394a`

本版是**跨机型 / 跨 Android 版本兼容性**修补版，功能与 x7root.5 相同。
完整的推演矩阵与「哪些必须用户自己处理」见 `docs/兼容性与机型适配.md`。

## 修补清单

| # | 问题 | 修补 |
|---|---|---|
| 1 | `su` 只在 Magisk / KernelSU 路径里找，**APatch** 用户探测不到 root | 候选表补充 `/data/adb/ap/bin/su`、`/data/adb/apd/bin/su`、`/data/local/bin/su` |
| 2 | 知识库目录写死公共外部存储，**未授予「所有文件访问」**的机型建目录失败 → 知识库不可用 | `knowledgeDir()` 三级降级：公共外部 → 应用专属外部(`Android/data/…`) → 内部目录，取第一个可写 |
| 3 | WebView API 仅补了 4 个，老 WebView（Chromium ≈90–120）可能报错 | 追加 `structuredClone`、`Object.hasOwn`、`Array/String.at`、`replaceAll`、`findLast(Index)`、`toReversed/toSorted/toSpliced/with`、`Promise.any`、`Object/Map.groupBy`、`Set` 集合运算、`AbortSignal.timeout/any` |
| 4 | 前台服务未声明类型 | 清单加 `FOREGROUND_SERVICE_DATA_SYNC`（面向 Android 14+；当前 targetSdk 28 属豁免，声明以备升级） |

Android 13+ 的通知运行时权限（`POST_NOTIFICATIONS`）在首次引导页已有申请逻辑，本版未改动。

## 验证

因没有第二台真机，本版采用 **静态成品校验 + 本地回归**，未做运行时真机验证：

| 项 | 方式 | 结果 |
|---|---|---|
| 新 polyfill 是否正确补齐 | 删除这些 API 后执行 `webview-compat.js` 再断言 | 14/14 通过 |
| 打进 APK 的 mobile.js 是否真的含新补丁 | 读取 `staging/…/dsh-web-frontend/dist/mobile.js` | `structuredClone/toSorted/AbortSignal.timeout` 均存在 |
| APK 是否声明新权限 | `aapt dump badging` | `FOREGROUND_SERVICE_DATA_SYNC` 存在 |
| dex 是否含新 su 路径 | 扫描 `classes.dex` | `/data/adb/ap/bin/su`、`/data/adb/apd/bin/su` 均存在 |
| 知识库插件（随包版本）回归 | 本地 Node 跑 `kb_add/kb_stats/kb_search` | 7 个工具注册正常；同标题去重生效；`DSH_KNOWLEDGE_DIR` 生效且未回退到 `DSH_HOME` |
| 真机运行时 | — | **未做**（手机未连接；上一版 x7root.5 在 Android 14 / ColorOS / KernelSU 上已实测通过） |

## 无法在软件层解决的

- **32 位(armeabi-v7a) / x86 设备**：运行时是 `android-arm64`，需自行替换。
- **Android 15+ 的 16 KB 页大小机型**：需按 16 KB 对齐重新编译原生运行时。
- **厂商私有后台开关**（MIUI/HyperOS、EMUI、OneUI 等）：App 无法代开，只能引导用户手动设置。
