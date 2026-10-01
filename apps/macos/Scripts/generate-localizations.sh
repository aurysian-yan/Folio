#!/bin/zsh
set -euo pipefail

# 从仓库根目录 locales/ 生成 macOS 本地化资源，直接写入应用 bundle 的 Resources。
# 生成结果不进入版本库，避免与 locales/ 中的源文案重复。
REPOSITORY_ROOT="$(cd "$SRCROOT/../.." && pwd)"
OUTPUT_DIRECTORY="$BUILT_PRODUCTS_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH"

NODE_EXECUTABLE="$(command -v node || true)"
if [[ -z "$NODE_EXECUTABLE" ]]; then
    for CANDIDATE in /opt/homebrew/bin/node /usr/local/bin/node; do
        if [[ -x "$CANDIDATE" ]]; then
            NODE_EXECUTABLE="$CANDIDATE"
            break
        fi
    done
fi

if [[ -z "$NODE_EXECUTABLE" ]]; then
    print -u2 "未找到 node，无法生成本地化资源"
    exit 1
fi

mkdir -p "$OUTPUT_DIRECTORY"
"$NODE_EXECUTABLE" "$REPOSITORY_ROOT/tools/i18n/build.mjs" --out "$OUTPUT_DIRECTORY"
