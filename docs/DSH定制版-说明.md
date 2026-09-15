# DSH 定制版（Oppo Find X7 · Root 专用）

> 基线：上游 `woaiys3/deepseek-harness-android-app` **v1.7.5**（仓库 HEAD 即该 tag，之后无新提交）
> 产物：`DeepSeekHarness-X7Root-v1.7.5-x7root.1.apk`
> 包名：`com.deepseek.harness`　versionCode `105`　versionName `1.7.5-x7root.1`　targetSdk `28`（保持 28，>=29 会让私有目录 noexec、node 起不来）

---

## 一、为什么需要定制

上游 v1.7.5 对 root 只是「顺带支持」，并没有为有 root 的旗舰机做优化：

1. **root 通道是一次性的**：每条特权命令都执行 `su -c "..."`，都重启一个 root shell、都过一遍 Magisk；
   命令之间 `cd`、环境变量、函数全部丢失，与「电脑端终端」体验差距很大。
2. **su 路径写死**：只调用 `PATH` 里的 `su`。ColorOS + Magisk/KernelSU/APatch 的 su 安装位置各不相同，
   一旦不在 App 的 PATH 里，特权通道直接判定为「不可用」，AI 的工具列表里连特权工具都不会出现。
3. **官方开发指南第九节自己写明**：无 root 的 Shizuku shell 上限就是 `shell`（uid=2000）——
   读不了 `/data/data/*`、读不了 `/data/system/`、改不了 `/system`。
   **「完全操控手机」只有 root 才做得到**，而这一版恰好把 root 的能力压在了 Shizuku 的水平。
4. 无障碍插件没有进「强制覆盖白名单」，从旧版升级的用户会一直用着旧的读屏/点击插件。

本定制版把「有 root 的 Find X7」当作一等公民重新实现特权层，同时补齐官方漏掉的构建与升级问题。

---

## 二、定制内容

### 1. 持久化 root shell（核心改动）

新增 `dsh-tool-shizuku/lib/root-shell.js`，把 root 通道从「一次性」改成「持久化」：

- 整个 App 只启动 **一个** `su` 进程，之后所有特权命令复用同一个 shell；
- **命令之间保留状态**：`cd /data/local/tmp` 之后再执行 `ls` 就在该目录，和电脑端终端一致；
- 免去每条命令的 root shell 启动 + 鉴权开销，连续系统操作快一个数量级；
- **哨兵分帧**：命令尾部追加 `printf` 标记 + `$?`，据此精确切分输出与退出码，不会把上一条命令的残留输出算进来；
- **健壮性**：命令超时自动 `SIGKILL` 并重建 shell；shell 意外退出立即让挂起请求失败；
- **不死锁**：命令被包在 `{ ... } </dev/null` 里执行，避免 `cat`/`read` 之类吃掉 root shell 自身的脚本输入（否则会永久卡住）；
- **自动降级**：若设备的 `su` 不支持无参交互 shell，自动回退一次性 `su -c`，功能不丢（并在结果里说明当前是一次性模式）。

### 2. su 路径自动发现

`MainActivity.probeRoot()` 重写：按顺序探测

```
/system/bin/su  /system/xbin/su  /sbin/su  /debug_ramdisk/su  /system/sbin/su
/vendor/bin/su  /product/bin/su  /data/adb/magisk/su  /data/adb/ksu/bin/su  su
```

- 单个候选 8 秒超时，总预算 30 秒（避免无 root 设备在权限页长时间卡住）；
- 用独立读线程 + `waitFor` 超时，原实现「先 readLine 再 waitFor」在 su 无输出时会永久阻塞；
- 探测成功把路径通过环境变量 `SU_BIN` 交给引擎插件，插件不再依赖 `PATH`；
- 结果缓存，`onResume` 时重置（授权后立刻能识别）。

### 3. 新增 4 个 root 专属工具

仅在 `ROOT_AVAILABLE=1` 时注册：

| 工具 | 能力 |
|---|---|
| `root_read_file` | **以 root 读取任意路径**（`/data/data/<包名>/`、`/data/system/`、`/data/adb/` …）。分块 + base64，二进制安全，`offset`/`length` 可读大文件 |
| `root_write_file` | **以 root 写入任意路径**，分块 base64，可设 `mode`（644/755），支持追加 |
| `android_device_probe` | 一次性体检：机型 / ColorOS 版本 / root 方案与 su 路径 / SELinux / 内核 / ABI / 电量温度 / 存储 / 屏幕分辨率与密度 |
| `android_optimize_keepalive` | **ColorOS 后台保活加固**：Doze 白名单 + `RUN_IN_BACKGROUND` appop + 活跃待机桶（本应用与 Shizuku），并列出仍需手动确认的 ColorOS 开关 |

### 4. 修复：无障碍插件纳入强制覆盖白名单

`FORCE_OVERWRITE_PREFIXES` 补上 `dsh-tool-accessibility/`。
原版白名单只覆盖 shizuku / android 两个插件，导致老用户外部 `/sdcard/DeepSeekHarness/dshroot` 永远保留旧的无障碍插件。

### 5. 构建侧修复（复现时必须）

- `javac` 加 `-encoding UTF-8`：Windows 默认 GBK，源码是 UTF-8，否则报「编码GBK的不可映射字符」直接编译失败；
- 编译用 **API 34** 的 `android.jar`（`accessibility_config.xml` 用到 `canTakeScreenshot`，API 30+ 才有），`targetSdk` 仍强制保持 28。

---

## 三、安装步骤（重要）

1. **先卸载官方版**。本包是自签名（`CN=DSH Root Custom`），与官方签名不同，无法覆盖安装。
   卸载会清掉 App 内部数据（**API Key、会话记录需要重新填**），但 `/sdcard/DeepSeekHarness/` 下的 dshroot 会保留，
   本版白名单会自动把新的 shizuku / android / accessibility 插件覆盖进去。
2. 安装 `DeepSeekHarness-X7Root-v1.7.5-x7root.1.apk`。
3. 打开 App，在权限引导页逐项授权：存储 / 所有文件访问 / 悬浮窗 / 修改系统设置 / 使用情况 / 安装未知来源 / 忽略电池优化 / 通知。
4. **授权 root**：首次触发特权命令时 Magisk（或 KernelSU/APatch）会弹窗，选「永久允许」。
5. 可选：系统设置 → 无障碍 → **DSH 定制版 屏幕助手**（读屏/点击/输入/截图，不需要 root）。

---

## 四、ColorOS 保活设置（Find X7 必做）

ColorOS 的后台冻结非常激进，不做这一步，长时间 AI 任务在锁屏后会被掐断。

可以让 AI 直接调用 `android_optimize_keepalive`（root 生效），它会完成 AOSP 层面能做的全部加固；
剩下的 ColorOS 私有开关需要手动确认：

1. 设置 → 应用 → 应用管理 → **DSH 定制版** → 耗电管理：
   允许**后台活动**、允许**自启动**、允许**关联启动**；
2. 设置 → 电池 → 更多设置：关闭对本应用的「智能省电」优化；
3. 最近任务卡片下拉 → **加锁**（防止一键清理）；
4. 同样设置 Shizuku（若你用它）。

---

## 五、验证定制是否生效

在 App 里对 AI 说：

- 「调用 `shizuku_status`」→ 应返回 `root(su)`，并显示 `su=/system/bin/su（持久 root shell 已就绪）`；
- 「调用 `android_device_probe`」→ 应返回 Find X7 机型、ColorOS 版本、su 路径、SELinux 状态；
- 「用 root 读一下 /data/system/packages.xml 的前 2000 字节」→ 能读到，说明特权文件访问已打通；
- 「调用 `android_optimize_keepalive`」→ 返回每条保活命令的执行结果。

---

## 六、安全提醒

这是一个**拥有完整 root 权限的 AI Agent**：它可以读写 `/data` 下任何应用的数据、改系统设置、装卸应用、改系统分区。
本版沿用了上游默认的 `permission` 预设 `danger-full-access`（`approval: never`），也就是**AI 执行特权命令不会逐次向你确认**。
请只在你自己完全信任的使用场景下运行；不要把它交给不受信任的对话方，也不要让 AI 访问来路不明的指令内容。

---

## 七、复现构建

官方仓库不含 `payload.zip`、`runtime/`、`dshroot/`、签名密钥，这些全部从**官方 APK 里回收**，因此可以完整复现：

```
dsh-android/
  extract/assets/payload.zip   从官方 v1.7.5 APK 抽出（110MB，未压缩存放）
  devhome/                     解开 payload.zip 得到的构建输入
    runtime/                   node v26 bionic（arm64）+ openssl/curl/rg
    dshroot/                   @deepseek-ai/dsh 0.1.1-rc.2 + 全部插件
    dshhome/                   .dsh 配置（cordis.patch.yml / settings.yaml / profiles）
    rish/                      rish_shizuku.dex
    build/env.sh               指向本机工具链
  toolchain/                   JDK 17 + build-tools 34 + platform-34 android.jar
  work/android-app/            被修改的 APK 构建工程（src/res/libs/AndroidManifest.xml/build.sh）
  custom/                      root-shell.js / root-tools.js 及单元测试
  dist/                        产物
```

构建命令（Git Bash）：

```sh
cd work/android-app
export DSH_DEV_HOME=/d/ai/gongzuoqu/dsh-android/devhome
export KEYSTORE_PASS=<签名密码>
sh build.sh          # 7 步：payload → aapt → javac → d8 → 打包 → zipalign → 签名
```

插件单元测试（Windows node 直接跑，用 Git Bash 冒充 POSIX shell 验证分帧与文件读写）：

```sh
cd custom
node test-root-shell.mjs     # 13/13
node test-root-files.mjs     #  8/8
```

---

## 八、已知限制

1. **签名不同 → 必须卸载重装**，API Key 与会话需重新配置。
2. 持久 root shell 的「状态保留」在命令超时后会重置（shell 被重建），这是有意为之的自我保护。
3. 若设备的 `su` 不支持无参交互 shell，会自动降级为一次性 `su -c`（功能可用，但命令间不留状态）。
4. 未在本版开启「每条特权命令逐次确认」；如需，可把 `SHIZUKU_APPROVE=ask` 注入引擎环境（改 `MainActivity.spawnNode` 的 env）。
5. 前端界面与交互完全沿用上游 v1.7.5（含移动端适配），本版只动特权层、root 工具与构建链。

---

## 九、产物与校验

| 项 | 值 |
|---|---|
| 文件 | `DeepSeekHarness-X7Root-v1.7.5-x7root.1.apk` |
| 大小 | 114,582,536 字节（约 109 MB） |
| SHA-256 | `fe54f2ac0b3834407e05f8657c466d89d26a37528a309336172efef1d885d02a` |
| 包名 / 版本 | `com.deepseek.harness` / versionCode **105** / versionName **1.7.5-x7root.1** |
| 签名 | APK Signature Scheme **v2 + v3** 校验通过 |
| 签名证书 | `CN=DSH Root Custom, OU=Android, O=DSH, L=Shenzhen, ST=Guangdong, C=CN`（RSA 2048） |
| 应用名 | DSH 定制版 |
| 内置内核 | `@deepseek-ai/dsh` **0.1.1-rc.2**（与官方 v1.7.5 APK 同一内核） |
| dshroot REVISION | `20260911212455` |
| targetSdk / minSdk | 28 / 24（targetSdk 必须保持 28） |

传输到手机后用 `sha256sum` 核对；损坏的 APK 系统会拒绝安装。

### 已做的验证

对**产物 APK 本身**（不是源码）完成：

- `apksigner verify`：v2/v3 签名有效；
- 从 APK 内 `assets/payload.zip` 抽出插件，SHA-256 与本地源码**逐一 MATCH**（含改写后的 `index.js`、新增的 `root-shell.js` / `root-tools.js`）；
- `classes.dex` 中确认包含 `SU_BIN`、`su-probe-reader`、`dsh-tool-accessibility`、`/data/adb/ksu/bin/su`（说明 Java 侧改动确实编进去了）；
- `resources.arsc` 中确认包含 `DSH 定制版`；
- `aapt dump badging`：包名/版本/targetSdk/应用名/启动 Activity 全部正确。

对**插件逻辑**用 Git Bash 冒充 POSIX shell 做了 21 项单元测试（`node test-root-shell.mjs` / `node test-root-files.mjs`）：

```
test-root-shell.mjs   13/13   输出与退出码、状态跨命令保留、stdout/stderr 分离、命令不存在=127、
                              多行输出、cat 不吞脚本、heredoc、超时终止、超时后自动恢复、
                              引号处理、500 行输出收集、并发排队不串帧
test-root-files.mjs    8/8    40000 字节随机二进制分块写入→分块读回逐字节一致、
                              追加/覆盖截断/空文件/含单引号与空格路径
```

### 尚未验证的部分（如实说明）

构建环境里**没有连接这台 Find X7**（`adb devices` 为空），因此以下是**没有真机验证**的：

- 在 ColorOS 上实际弹出 Magisk 授权、`su` 无参交互 shell 是否成功（若失败会自动降级为一次性 `su -c`，功能不丢）；
- ColorOS 对 `android_optimize_keepalive` 各条命令的实际反应；
- App 冷启动、WebView 加载、无障碍服务开启后的实际读屏效果。

首次使用时建议按「第五节」逐项自查；若 `shizuku_status` 返回的不是 `root(su)`，把返回内容发我，我据此定位。

### 改动源码清单（`dist/patch/`）

```
patch/plugins/dsh-tool-shizuku/lib/index.js        官方插件 + 接入持久 root shell + 注册 root 工具
patch/plugins/dsh-tool-shizuku/lib/root-shell.js   新增：持久化 root shell 通道
patch/plugins/dsh-tool-shizuku/lib/root-tools.js   新增：4 个 root 专属工具
patch/android-app/src/.../MainActivity.java        su 多路径探测 + SU_BIN + 无障碍插件进白名单
patch/android-app/AndroidManifest.xml              versionCode/versionName
patch/android-app/strings.xml                      应用名 → DSH 定制版
patch/android-app/build.sh                         javac -encoding UTF-8
patch/android-app/env.sh                           编译工具链 + API 34 android.jar
patch/tests/*.mjs                                  插件单元测试
```

