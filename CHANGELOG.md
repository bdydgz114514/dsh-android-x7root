# 变更记录（本分支）

> 上游基线的变更见 @CHANGES.md@。

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
