# 第三方组件与许可 / Third-party notices

本仓库自身以 MIT 发布（见 @LICENSE@）。它依赖、打包或在运行时使用以下第三方软件；
所有商标与版权归各自所有者。本仓库**不重新分发**任何签名密钥或账号凭证。

| 组件 | 许可 | 用途 |
|---|---|---|
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (@@deepseek-ai/dsh@ 及 @@deepseek-ai/dsh-*@) | MIT | 内核与插件框架 |
| [woaiys3/deepseek-harness-android-app](https://github.com/woaiys3/deepseek-harness-android-app) | MIT | 上游 Android 壳与构建脚本 |
| Node.js (android-arm64 运行时) | MIT | 运行引擎（**不在本仓库**，仅随 APK 分发） |
| [Shizuku](https://github.com/RikkaApps/Shizuku) (rish / api / provider) | Apache-2.0 | 无 root 特权通道 |
| [mammoth](https://github.com/mwilliamson/mammoth.js) | BSD-2-Clause | docx 读取 |
| [docx](https://github.com/dolanmiu/docx) | MIT | docx 生成 |
| [exceljs](https://github.com/exceljs/exceljs) | MIT | xlsx 读写 |
| [pptxgenjs](https://github.com/gitbrent/PptxGenJS) | MIT | pptx 生成 |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | MIT | PDF 生成 |
| [pdfjs-dist](https://github.com/mozilla/pdf.js) | Apache-2.0 | PDF 解析 |
| [jszip](https://github.com/Stuk/jszip) | MIT 或 GPLv3（双许可，本项目按 MIT 使用） | zip 读写 |
| [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) | MIT | OOXML 解析 |
| [React](https://react.dev) | MIT | 定制设置页（由 DSH 前端内置提供） |
| AndroidX / Shizuku AAR | Apache-2.0 | Android 支持库 |

构建产物中还包含 Android SDK 生成的少量代码与资源，其归属见各自许可。
