# DSH 源码补丁说明

> DeepSeek Harness（DSH）在 Android 上的适配补丁归档。更新 DSH 内核后，用 `apply.sh` 重新应用。

## 目录结构

```
dsh-patches/
├── README.md              本文件
├── apply.sh               重新应用源码补丁（带语法自检）
└── overlay/               改好后的源码文件
    └── lib/node_modules/@deepseek-ai/dsh/node_modules/
        ├── dsh-app-boot/                 内部模块加载（0.1.6 起必需：绕开无 android 构建的原生插件）
        ├── dsh-subprocess-local/          子进程模拟（适配 Android）
        ├── dsh-attachment-local/          附件处理（适配 Android）
        ├── dsh-bash-local/                bash 沙箱兼容
        ├── dsh-session-persistence-jsonl/ 会话持久化（适配 Android）
        ├── dsh-tool-shizuku/              Shizuku 特权插件（三层修复版）
        └── dsh-tool-android/              系统能力插件
```

## 架构

```
APK (com.deepseek.harness)
├── Android 壳（MainActivity：权限引导页 + WebView + 解压 payload + 拉起 node）
├── payload（首次解压到 files/）
│   ├── runtime/               node 二进制 + .so
│   ├── dshroot/               DSH 内核（含本补丁）
│   ├── dshhome/               DSH 配置（无凭证）
│   └── bin/bash               shim（/system/bin/sh）
└── 前端 = DSH 原生界面 + mobile-patch 移动端适配
    ├── 页面加载 http://127.0.0.1:3080
    ├── 发消息：POST /api/session.prompt
    └── 收流式回复：WebSocket ws://127.0.0.1:3080/api/events.mux
```

## Android 源码补丁

DSH 有 5 处需要适配 Android 的源码改动，更新 DSH 后需重新应用：

| 补丁 | 原因 | 改动 |
|---|---|---|
| dsh-app-boot | **0.1.6 起**内核用 `node-addon-require-builtin` 加载 Node 内部模块，而该包**没有 android-arm64 构建**（可选包只有 darwin / linux-glibc / win32），加载期即抛 "No usable native binding found …-android-arm64"，引擎根本起不来 | `internalModules()` 改为**优先用 `--expose-internals` 直接 require 内部模块**（应用本来就带这个参数，等价可用），原生插件退化为兜底 |
| dsh-subprocess-local | node-pty 原生模块 Android 无法编译；koffi（dsh-win32-process）同样不可用 | node-pty → `spawnPtyCompat`（child_process 模拟）；win32-process 改按需 `createRequire` |
| dsh-attachment-local | sharp/libvips 原生模块不存在；Android 禁硬链接；目录 fsync 可能 EACCES | 纯 JS 头解析（PNG/JPEG/WEBP/GIF）；规范化字节透传；`link()` → 独占复制；fsync best-effort |
| dsh-bash-local | 原生沙箱禁用后需兼容 | 补 sandboxMode getter |
| dsh-session-persistence-jsonl | Android SELinux 禁硬链接 | `link()` → `rename()` / 独占复制 |

> **overlay 里的文件是「整份文件」覆盖，不是 diff。** 因此**内核大版本升级后必须重新移植**：
> 先取新版本包的原始文件（`npm pack @deepseek-ai/<包>@<版本>`），
> 与旧 overlay 做 `git diff --no-index` 得到「Android 改动」，
> 再把同样的改动应用到新版本源码上——直接套用旧 overlay 会把上游新功能回退掉。
> 0.1.5-rc.2 → 0.1.6-alpha.2 就是这么做的（新增了 `createLazyRequire` 惰性加载体系，
> 所以 node-pty / sharp 的顶层 import 不再需要 shim）。

## 如何升级 DSH 版本

```sh
# 1. 安装新内核（开发环境，Windows 上可用 npm）
mkdir -p /tmp/kc && cd /tmp/kc
npm install --no-audit --no-fund @deepseek-ai/dsh@<新版本>
#    然后把 node_modules 整理成 pnpm 风格的两层布局：
#      <devhome>/dshroot/lib/node_modules/@deepseek-ai/dsh/            ← 内核包本体
#      <devhome>/dshroot/lib/node_modules/@deepseek-ai/dsh/node_modules/  ← 全部依赖（含 @deepseek-ai/*）

# 2. 把 Android 补丁移植到新内核源码（见上面「必须重新移植」）
node upgrade/k016-win/test-port-016.mjs   # 34 项移植自检

# 3. 内嵌插件逐个装依赖（插件依赖装在插件自己的 node_modules 里）
cd <devhome>/dshroot/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/<插件>
npm install --omit=dev --legacy-peer-deps

# 4. 剔除平台不匹配的原生包与开发期文件（否则 APK 体积失控）
#    libreoffice-kit-win32-x64 / @img/sharp-* / node-pty / @vscode/ripgrep
#    *.map *.d.ts docs tests（约 236 MB）

# 5. 重新打包 APK（会自动注入 mobile-patch 移动端适配）
cd android-app && bash build.sh
```

## 如何打包 APK

```sh
cd android-app && bash build.sh
# 产物：android-app/DeepSeekHarness.apk
```

build.sh 会自动：

1. 组装 payload（runtime + dshroot + dshhome + bin）
2. 注入移动端适配（`mobile-patch/inject.sh`，mobile.css + mobile.js 到 DSH 前端 dist）
3. 安全检查（payload 里禁止出现 API Key / .credentials.yaml）
4. aapt/javac/d8/zipalign/apksigner 全流程

## 移动端适配（mobile-patch/）

- 纯 CSS/JS 注入，不覆盖 DSH 原生页面
- `mobile.css`：触摸优化 + 插件管理页 UI 适配
- `mobile.js`：软键盘适配（VisualViewport 方案）
- 改适配 = 改 `mobile-patch/` 里的文件，重新 `build.sh` 即可，不碰 DSH 源码

## 插件管理

DSH 插件系统（cordis）通过 `dsh plugin`（内部转 pnpm）安装：

```sh
source $DEV_HOME/runtime/env.sh
export DSH_HOME=$DEV_HOME/.dsh
node --expose-internals $DEV_HOME/dshroot/lib/node_modules/@deepseek-ai/dsh/lib/bin.js \
  plugin --profile web add <插件包名>
```

装完重新 `build.sh` 打进 APK。注意：插件若依赖原生模块，需像上面 4 个补丁一样做 Android 适配。

## 关键注意事项

- node 运行需要 `LD_LIBRARY_PATH=runtime/lib`（libz/libicu 等软链由 APK 首次解压后按 LINKS.txt 重建）
- DSH 启动必须 `--expose-internals`（否则 HMR 报错）
- Android 无 `/usr/bin/env`，所有 wrapper 用 `#!/system/bin/sh`
- API Key 通过页面 `credentials.set` 写入本机，**绝不打包进 APK**
