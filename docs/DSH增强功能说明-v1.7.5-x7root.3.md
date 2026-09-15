# DSH 定制版 · 功能增强说明（v1.7.5-x7root.3）

> 内核：`@deepseek-ai/dsh@0.1.5-rc.2`（不变）
> 产物：`DeepSeekHarness-X7Root-v1.7.5-x7root.3.apk`
> 包名 `com.deepseek.harness`　versionCode `109`　versionName `1.7.5-x7root.3`　targetSdk `28`
> 大小 139,068,424 字节　SHA-256 `802bcd85b4eb78d912018a2d5a6358f8fc7e89f934d0473b3022a5d6ab8c0989`

本版在 x7root.2 基础上新增四项能力，全部**内置进 APK**，不依赖外部 App。

---

## 一、Office 文档引擎（新增插件 `dsh-tool-office`）

内置 8 个纯 JS 库（mammoth / docx / exceljs / pptxgenjs / pdf-lib / pdfjs-dist / jszip / fast-xml-parser，**零原生 .node**），
AI 可直接读写文档，无需手机安装 WPS/Office：

| 工具 | 能力 |
|---|---|
| `office_read` | 读取 .docx（含表格→Markdown）、.xlsx/.xlsm（逐表逐行）、.csv、.pptx（逐页文本）、.pdf（逐页文本）、.odt/.ods/.odp、.md/.txt/.html/.json |
| `office_write` | 创建 .docx（标题/段落/列表/表格）、.xlsx（多工作表/公式）、.csv、.pptx（多页/要点/备注）、.pdf、文本类 |
| `office_edit` | xlsx/csv 改单元格、加行、增删/重命名工作表；pdf 追加页、改标题；docx 文本替换 |
| `office_info` | 类型/大小/工作表/页数 |
| `office_convert` | docx→md/html/txt、xlsx↔csv、pptx/pdf→txt、md/txt→docx/xlsx/pptx/pdf |

**限制**：pdf-lib 内置字体只支持拉丁字符，中文 PDF 生成会丢字（中文请用 docx/xlsx/pptx，或先写 txt/docx）。docx 的 `replace` 只在同一文本片段内生效，结构性改动请「读出来 → 重写」。

## 二、预制触控能力

原有无障碍插件已具备完整触控（`android_screen` 读控件树并给出坐标、`android_tap/android_hold/android_swipe/android_touch/android_gesture/android_scroll/android_type/android_see` 等），
另可用 Shizuku/root 的 `android_input`。

本版**新增 `android_gesture_preset`**：一条调用完成常用手势——
`back` / `home` / `recents` / `notifications` / `quick_settings` /
`scroll_top` / `scroll_bottom` / `zoom_in(pinch_out)` / `zoom_out(pinch_in)` / `double_tap` / `long_press`，
支持 `fx/fy` 锚点与 `durationMs`。使用前需在系统设置开启无障碍服务。

本版另新增 `android_find`：按文字/描述/类名定位控件并返回**中心坐标**（只查找、不点击），配合 `android_screen` 使用；
并新增一段「先定位、再触控」的屏幕操作系统提示。无障碍插件现共 **15 个**工具。

## 三、文件与图片上传（修复）

**根因**：App 只设置了 `WebViewClient`，没有 `WebChromeClient`，浏览器的 `<input type=file>` 无人响应 → 点上传毫无反应。
**修复**：新增 `WebChromeClient.onShowFileChooser`，接系统文件选择器（支持多选），请求图片时附带「拍照」入口（写入 MediaStore，无需 CAMERA 权限），
并实现 `onPermissionRequest`（本地回环页面直接授权）。结果经 `onActivityResult` 回传 WebView。

> 关于「把 MT 管理器打包进去」：MT 管理器是第三方闭源商业软件，不能随本 APK 分发。
> 上传已改为系统文件选择器（等价能力），文件管理可继续用 DSH 自带的文件工具/侧栏。若你自行安装了 MT 管理器，DSH 也能像调用其它 App 一样打开它。

## 四、本地知识库（新增插件 `dsh-tool-knowledge`）

- **存储**：`$DSH_HOME/knowledge/kb.sqlite`（SQLite + FTS5 **trigram** 全文检索，支持中文子串）+ `entries/<id>.md`。
- **工具**：`kb_search` / `kb_get` / `kb_add` / `kb_list` / `kb_stats` / `kb_delete` / `kb_digest`。
- **自动沉淀**：监听 `session/event` 的 `turn/end`，每轮对话结束后在后台用**当前模型**把本轮整理成
  「问题现象 + 解决办法 + 标签」入库；纯闲聊/无复用价值时模型返回 `{"useful": false}`，不入库。
  同「标题+问题」的条目会覆盖更新（自动去重）。默认每轮结束 4 秒后整理、两次整理间隔至少 15 秒。
- **提示词**：自动注入一段系统提示，要求「排障前先 `kb_search`，解决后 `kb_add`」，因此越用越强。
- **诊断**：每次触发/整理都会向 `$DSH_HOME/knowledge/distill.log` 追加一行 JSON（hook / model / history / not-useful / stored / error），便于排查为何未入库。
- 可用 `kb_digest` 手动触发一次整理；`kb_stats` 查看条目数与存储位置、诊断日志路径。

## 五、验证情况

**已在本机（Node 26 同源代码）完成**：

- Office 插件 5 个工具全部冒烟通过：docx（含表格）写→读、xlsx 多表写→读→改（改单元格/加行/加表）、
  csv 写→改→读（含引号转义）、pptx 写→info→读、pdf 写→读（pdfjs 抽取）→追加页/改标题、docx→md、xlsx→csv。
- 知识库插件全部通过：注册 7 个工具、`kb_add`/`kb_search`（中文子串命中）/`kb_get`/`kb_list`/`kb_stats` 正常；
  模拟 `turn/end` 后自动整理入库成功；`useful:false` 不入库。
- 用升级后的完整内核启动引擎（`--profile web`）：`dsh-tool-office`、`dsh-tool-knowledge` 均加载成功，
  `--dump-config` 可见两条 insert 项，`profiles/node_modules` 已为二者建立软链，引擎正常监听并返回首页。
- 删除全部原生二进制后 Office 库仍可用（无 `.node` 依赖）。
- **真实 `defineTool` 校验**：office 5 个 + knowledge 7 个工具在真实 DSH 定义器下全部编译通过并实际执行
  （xlsx 写→读→改、kb_add→kb_search 命中），说明参数/输出 schema 写法符合 DSH 约束（此前 mock 不校验 DSL）。
- **无障碍插件**在真实 `defineTool` 下注册 **15 个**工具，含新增 `android_find`（元素定位）与 `android_gesture_preset`（预置手势），
  并贡献 1 段屏幕操作系统提示（`tool-accessibility:instructions`）。
- **打包产物自检**：直接从 APK 抽取 `assets/payload.zip` 解包后（模拟 App 首次解压）用该目录启动引擎成功，
  证明 jar/aapt 打包未破坏 office 依赖与插件。
- 真机验证脚本已备好：`upgrade/verify-ondevice.ps1` + `upgrade/device-harness.mjs`，手机连上后一条命令完成
  安装、启动、真机 android-arm64 node 上的 office/knowledge 实测、FTS5 检测与日志抓取。

**真机验证（Android 14 / PHZ110 / 系统 WebView 117 / KernelSU root）——已全部通过**：

- **① Office**：用 App 内置的 android-arm64 node（v26.4.0）以真实 DSH 依赖加载插件，12 个工具注册成功；
  实测 docx（中文+表格）写→读、xlsx 多表写→读→**改单元格**、pptx 写→读、pdf 写→读（pdfjs 抽取）、csv、xlsx→csv 全部通过。
- **② 触控 / UI 定位**：root 临时开启无障碍服务后 `android_a11y_status` running=true；`android_screen` 返回 19 个控件；
  **`android_find` 精确定位「退出」→ center=(972,237)**；`android_tap`（手势注入）、`android_gesture_preset`（scroll_top）、`android_touch_status` 均成功。
- **③ 上传**：点「添加附件」弹出系统 ChooserActivity（相机 / 媒体）；选「媒体」进入 DocumentsUI，选一张截图后返回 DSH，
  **图片已作为附件缩略图出现在输入区**（证明 `<input type=file>` → `onShowFileChooser` → 回传 URI 全链路可用）。
- **④ 知识库**：`kb_add` / `kb_search`（中文子串）/ `kb_stats` 在真机 FTS5 下可用；真实发一轮消息后，`distill.log` 记录
  **hook(turn/end) → model(deepseek-official/deepseek-flash) → history(4 条) → stored**，自动生成条目「Android WebView 上传按钮无反应的修复」
  （含现象 / 解决办法 / 标签），`entries/bddd96b79d42.md` 已落盘。

> 验证中曾临时用 root 开启无障碍服务、临时停用搜狗输入法以注入 ASCII；验证后均已恢复（输入法已重新启用并设为默认）。

## 六、补丁与复现

```
dist/patch-0.1.5/
  android-app/MainActivity.java      # 文件选择器（WebChromeClient）改动
  android-app/AndroidManifest.xml    # versionCode 109 / versionName 1.7.5-x7root.3
  plugins/dsh-tool-office/           # 新插件源码（依赖需 npm install --ignore-scripts --omit=optional）
  plugins/dsh-tool-knowledge/        # 新插件源码（无外部依赖）
  mobile-patch/                      # WebView 兼容层（x7root.2 引入）
  patched-files/node-addon-system-flock.js
  patch-015.mjs / build-apk.sh / README.md
```

Office 依赖安装（在插件目录内）：
`npm install --ignore-scripts --omit=optional --no-audit --no-fund`
（必须 `--omit=optional`：pdfjs-dist 的可选依赖会拉入 `@napi-rs/canvas` 原生包。）
安装后总 101 MB，可安全删除 `pdfjs-dist/{build,web,types,image_decoders}`、`pdf-lib/{dist,src,ts3.4}`、
`exceljs/dist`、`@types/node`，降到约 50 MB（已验证功能不受影响）。
