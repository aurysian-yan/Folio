#!/bin/zsh
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUTPUT_DIRECTORY="$REPOSITORY_ROOT/apps/macos/Generated"

cd "$REPOSITORY_ROOT"
cargo build --package folio-ffi --lib
cargo run --package folio-ffi --bin uniffi-bindgen -- \
    generate \
    --library "$REPOSITORY_ROOT/target/debug/libfolio_ffi.dylib" \
    --language swift \
    --out-dir "$OUTPUT_DIRECTORY" \
    --no-format
cp "$OUTPUT_DIRECTORY/folio_ffiFFI.modulemap" "$OUTPUT_DIRECTORY/module.modulemap"
