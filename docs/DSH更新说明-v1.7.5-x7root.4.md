# DSH 定制版 · 更新说明（v1.7.5-x7root.4）

> 内核：`@deepseek-ai/dsh@0.1.5-rc.2`（不变）
> 产物：`DeepSeekHarness-X7Root-v1.7.5-x7root.4.apk`
> 包名 `com.deepseek.harness`　versionCode `111`　versionName `1.7.5-x7root.4`　targetSdk `28`
> 大小 139,068,424 字节　SHA-256 `25f10797c6251549714fd3cbb23bd0b48fac695c3352fd89a35755fae0551192`

本版在 x7root.3 基础上按需求做三项改动（另附一个知识库去重修复）。所有设置都在**右上角新增的「设置」按钮**里（在「退出」左侧）。

---

## 一、运行模式：有 root / 无 root（可在设置切换）

- 设置 → **运行模式** → 单选「有 root（使用 su 特权）」/「无 root（仅 Shizuku / 普通权限）」。
- 选择后写入偏好并提示**立即重启**（重启会先结束旧引擎再拉起，避免端口冲突）。
- 引擎行为（环境变量）：
  - 有 root：`DSH_RUN_MODE=root`、`ROOT_AVAILABLE=1`、注入 `SU_BIN` → 注册 4 个 root 专属工具、特权命令走 su。
  - 无 root：`DSH_RUN_MODE=noroot`、`ROOT_AVAILABLE=0`、不注入 su → 不注册 root 工具，特权通道回退 Shizuku（若已授权），否则只用普通权限。
- 无 root 模式适合不想给 AI root 的场景；文件读写/预览/编辑不受影响（只需存储权限）。

## 二、知识库：入口进设置 + 跨更新保留

- 设置 → **知识库**：显示目录、条目数、最近条目标题，并提供「打开目录 / 复制路径」。
- **目录迁到外部共享存储**：`/sdcard/DeepSeekHarness/knowledge`（引擎通过 `DSH_KNOWLEDGE_DIR` 使用它）。
  覆盖安装（`adb install -r`）甚至卸载重装都不会清除，因此**知识库不会因更新丢失**。
- **一次性迁移**：启动时若外部目录为空而内部旧知识库存在，自动整树复制过去（本次真机迁移了 18 条历史条目）。
- 另有诊断日志 `knowledge/distill.log`，记录每次自动整理（hook/model/history/stored/not-useful/error）。

## 三、取消每次启动的自动检查更新

- 已移除启动时的 `checkForUpdate()` 调用，启动不再联网检查 GitHub 版本。
- 保留**手动入口**：设置 → 检查更新（手动）。

## 四、附带修复：知识库同名重复

自动整理时问题描述会被模型改写，原来按「标题+问题」生成 id，导致同名不同 hash 的重复条目。
现改为**同标题（去空格/大小写归一）覆盖更新**，并在写入时按标题回查已有条目复用其 id（兼容历史数据）。

---

## 五、真机验证（Android 14 / PHZ110 / KernelSU root）

| 项 | 结果 |
|---|---|
| 设置入口 | 右上角「设置」按钮出现，菜单含运行模式/知识库/检查更新/AI 工作区 |
| 切换到无 root | 偏好写入 → 提示重启 → 重启后 `ps` 显示 **1 个 node 进程**，env：`DSH_RUN_MODE=noroot`、`ROOT_AVAILABLE=0`、`DSH_KNOWLEDGE_DIR=/storage/emulated/0/DeepSeekHarness/knowledge` |
| 切回有 root | 重启后仍 **1 个 node 进程**，env：`DSH_RUN_MODE=root`、`ROOT_AVAILABLE=1` |
| 知识库迁移/保留 | 覆盖安装 111 后外部目录仍有 **18 条**历史条目；设置对话框正确显示目录/条目数/最近标题 |
| 同名去重 | 真机 harness：同标题写入两次 → 条目数保持 1，内容更新为第二次的解决办法 |
| 无障碍 | 安装后系统会重置无障碍服务，已重新开启（`accessibility_enabled=1`） |

> 修复的一个中间问题：切换模式时看门狗会把已结束的引擎自动拉起，导致第二个 node 报 `EADDRINUSE`。
> 已加 `engineRestarting` 标志，切换期间看门狗不再自动拉起；复测全程只有 1 个引擎进程。

## 六、补丁文件

```
dist/patch-0.1.5/
  android-app/MainActivity.java        # 设置按钮/运行模式/知识库/关闭自动更新/看门狗标志
  android-app/ScheduleExecutor.java    # 定时任务引擎同样使用外部知识库目录
  android-app/AndroidManifest.xml      # versionCode 111 / versionName 1.7.5-x7root.4
  plugins/dsh-tool-knowledge/lib/index.js  # DSH_KNOWLEDGE_DIR + 同标题去重 + distill.log
  mobile-patch/device-env.sh / device-kbdedup.mjs  # 真机验证脚本
```

## 七、已知限制

- 运行模式与知识库目录改动**需要重启引擎**生效（切换时会提示）。
- 「打开目录」依赖手机上有能接收 `resource/folder` 的文件管理器；没有时只提示路径（可「复制路径」）。
- 无 root 模式下若 Shizuku 也未授权，AI 无法执行系统级操作（与预期一致）。
