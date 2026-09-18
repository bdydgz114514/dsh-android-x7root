#!/system/bin/sh
# 把 dsh-patches/overlay 下的补丁文件覆盖回 dshroot
# 用途：更新 DSH（npm 重装）后，重新应用 Android 所需的源码补丁 + Shizuku 插件。
# 前端 = DSH 原生界面 + 移动端适配（mobile-patch/，由 android-app/build.sh 打包时注入）。
# 用法：sh dsh-patches/apply.sh
set -e
# 开发环境主目录，可 export DSH_DEV_HOME 覆盖
H="${DSH_DEV_HOME:-/data/data/com.coomi.android/files/home}"
SRC="$H/dsh-patches/overlay/lib"
DST="$H/dshroot/lib"
RUNTIME="$H/runtime"
NODE="$RUNTIME/bin/node"

if [ ! -d "$SRC" ]; then
  echo "找不到补丁目录：$SRC" >&2
  exit 1
fi
if [ ! -d "$DST" ]; then
  echo "找不到 dshroot：$DST" >&2
  exit 1
fi

echo "== 应用补丁 overlay -> dshroot =="
( cd "$SRC" && tar cf - . ) | ( cd "$DST" && tar xf - )

export LD_LIBRARY_PATH="$RUNTIME/lib"
export DSHROOT_PKG="$DST/node_modules/@deepseek-ai/dsh/package.json"

echo "== 内核版本比对（overlay 内文件是按新内核源码移植的，套错版本会回退上游代码）=="
if [ -f "$DSHROOT_PKG" ]; then
  KERNEL_VER="$("$NODE" -e 'console.log(require(process.env.DSHROOT_PKG).version)' 2>/dev/null || true)"
  echo "  当前 dshroot 内核版本: ${KERNEL_VER:-未知}"
  echo "  注意: overlay 内的 dsh-subprocess-local / dsh-attachment-local / dsh-bash-local /"
  echo "        dsh-session-persistence-jsonl 是针对 @deepseek-ai/dsh@0.1.6-alpha.2 源码用同名包版本移植的；"
  echo "        若上游小版本有改动，请先按 dsh-patches/README.md 的流程重新移植，再应用本脚本。"
fi

echo "== 把定制插件加入 dsh package.json 依赖（幂等）=="
"$NODE" -e '
const fs = require("fs");
const p = process.env.DSHROOT_PKG;
const m = JSON.parse(fs.readFileSync(p, "utf8"));
m.dependencies = m.dependencies || {};
const plugs = [
  "@deepseek-ai/dsh-tool-shizuku",
  "@deepseek-ai/dsh-tool-android",
  "@deepseek-ai/dsh-tool-accessibility",
  "@deepseek-ai/dsh-tool-office",
  "@deepseek-ai/dsh-tool-knowledge",
  "@deepseek-ai/dsh-client-ui-settings-custom"
];
const added = [];
for (const name of plugs) {
  if (!m.dependencies[name]) { m.dependencies[name] = "0.1.0"; added.push(name); }
}
if (added.length) {
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
  console.log("  已添加依赖: " + added.join(", "));
} else {
  console.log("  依赖已存在，跳过");
}
'

echo "== 语法自检（5 个 JS 补丁）=="
for f in \
  "$DST/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js" \
  "$DST/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-attachment-local/lib/index.js" \
  "$DST/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-bash-local/lib/index.js" \
  "$DST/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js" \
  "$DST/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-shizuku/lib/index.js" ; do
  if [ -f "$f" ]; then
    if "$NODE" --check "$f" 2>/dev/null; then
      echo "  OK: ${f##*/dshroot/lib/}"
    else
      echo "  FAIL: ${f##*/dshroot/lib/}" >&2
      exit 1
    fi
  else
    echo "  MISSING: $f" >&2
    exit 1
  fi
done

echo "== 完成 =="