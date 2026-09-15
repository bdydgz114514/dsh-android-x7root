# DSH 定制版 · 更新说明（v1.7.5-x7root.5）

> 内核：`@deepseek-ai/dsh@0.1.5-rc.2`（不变）
> 产物：`DeepSeekHarness-X7Root-v1.7.5-x7root.5.apk`
> 包名 `com.deepseek.harness`　versionCode `113`　versionName `1.7.5-x7root.5`　targetSdk `28`
> 大小 139,076,616 字节　SHA-256 `81cfbf7d0867780e31ab7c3dd1ff873092348c03ae213dc68872d9f6bc0f1fd6`

本版把上一版加在**右上角**的 App 设置**并入 DSH 左下角（齿轮）自带设置**，并**移除**右上角独立的「设置」按钮。

---

## 一、怎么用

左下角齿轮 → **设置** → 顶部标签栏第二个 **「定制」**（紧挨「通用设置」）：

| 行 | 内容 |
|---|---|
| 运行模式 | **有 root** / **无 root** 两个按钮；点选即写入偏好并弹出原生「立即重启 / 稍后手动重启」 |
| 知识库 | 显示**条目数**与**外部目录路径**，按钮「打开目录」「复制路径」 |
| 检查更新 | 说明「已取消启动自动检查」，按钮手动检查 |
| 关于 | 定制版版本、内核版本、包名 |

整页使用 DSH 自身的 row 样式（`token` 与排版与「权限 / 语言 / 外观」完全一致）。

## 二、实现方式

- **不再用 App 原生的 AlertDialog 设置**：新增客户端插件
  `@deepseek-ai/dsh-client-ui-settings-custom`，通过 DSH 的槽位系统注册一个新的设置页：
  `ctx.slots.inject("settings.section", () => ctx.slots.register({ name:"settings.section", id:"custom", order:5, label:()=>t("nav"), locale:NS }, Section))`
  —— 这是 DSH 官方扩展设置页的正规入口（与「通用设置」「模型」「插件」同一机制）。
- **打包与加载**：插件同时是 profile 的一个 Loader 条目（`.dsh/cordis.patch.yml` 的 `insert`）并声明 `dsh.client`，
  `dsh-client-modules` 据此把它编入 `window.__DSH_BOOT__` 供浏览器加载；客户端 bundle 为 DSH 约定的
  `window.__ModuleLoader__.load({ id, factory })` 懒加载 CJS 格式，只 require 平台内置的 `react` 与
  `@deepseek-ai/dsh-client-ui-primitives`。
- **原生桥**：MainActivity 通过 `webView.addJavascriptInterface(new NativeBridge(), "DSHNative")` 暴露
  `getState` / `setRunMode` / `requestRestart` / `openKnowledgeDir` / `copyKnowledgePath` / `checkUpdate`；
  设置页据此读写偏好、重启引擎、打开/复制知识库、手动检查更新。
- **安全**：同时新增 `shouldOverrideUrlLoading`，只允许本地回环页面留在 WebView，其余交给系统浏览器，避免外部页面触达该桥。

## 三、真机验证（Android 14 / PHZ110 / KernelSU root）

| 项 | 结果 |
|---|---|
| 标签并入 | 设置页标签栏出现 **「通用设置 / 定制 / 模型 / 插件 / Agent 预设」**，风格一致 |
| 运行模式双向切换 | 在设置里点「无 root」→ 原生确认 → 立即重启 → 新引擎 `DSH_RUN_MODE=noroot`、`ROOT_AVAILABLE=0`；点回「有 root」→ `root` / `1`，全程 **1 个 node 进程** |
| 知识库入口 | 显示「共 18 条 · /storage/emulated/0/DeepSeekHarness/knowledge（外部存储，App 更新不会清除）」 |
| 检查更新 | 手动按钮存在；启动不再自动检查 |
| 右上角按钮 | 已移除（只剩「退出」） |

## 四、补丁文件

```
dist/patch-0.1.5/
  plugins/dsh-client-ui-settings-custom/   # 新增：DSH 内置设置里的「定制」页（package.json / lib/index.js / lib/client.js）
  android-app/MainActivity.java            # DSHNative 桥 + shouldOverrideUrlLoading + 移除右上角设置按钮
  android-app/AndroidManifest.xml          # versionCode 113 / versionName 1.7.5-x7root.5
```

注册片段（`devhome/.dsh/cordis.patch.yml` 与 `dshhome/cordis.patch.yml` 均已写入）：
```
    - id: client-ui-settings-custom
      name: '@deepseek-ai/dsh-client-ui-settings-custom'
```

## 五、说明与限制

- 「定制」标签放在**第二位**（`order 5`）：起初放在最后（`order 100`）时，本机标签栏无法用手指横滑到末尾，故前置以保证可见可点。
- 运行模式/知识库目录改动需**重启引擎**生效（设置页会提示）。
- 若在非 App 环境（例如桌面浏览器）打开该页面，会显示「未连接到 App」提示。
