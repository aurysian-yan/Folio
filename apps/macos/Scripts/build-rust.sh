#!/bin/zsh
set -euo pipefail

REPOSITORY_ROOT="$(cd "$SRCROOT/../.." && pwd)"
OUTPUT_LIBRARY="$BUILT_PRODUCTS_DIR/libfolio_ffi.a"
CARGO_EXECUTABLE="$(command -v cargo || true)"
export CARGO_TARGET_DIR="$PROJECT_TEMP_DIR/rust-target"
MINIMUM_MACOS_VERSION="${MACOSX_DEPLOYMENT_TARGET:-15.0}"
unset MACOSX_DEPLOYMENT_TARGET

if [[ -z "$CARGO_EXECUTABLE" ]]; then
    CARGO_EXECUTABLE="$HOME/.cargo/bin/cargo"
fi

TARGETS=()
LIBRARIES=()
for ARCHITECTURE in ${=ARCHS}; do
    case "$ARCHITECTURE" in
        arm64) RUST_TARGET="aarch64-apple-darwin" ;;
        x86_64) RUST_TARGET="x86_64-apple-darwin" ;;
        *) continue ;;
    esac
    TARGET_CFLAGS="CFLAGS_${RUST_TARGET//-/_}=-mmacosx-version-min=$MINIMUM_MACOS_VERSION"
    TARGETS+=("$RUST_TARGET")
    env "$TARGET_CFLAGS" "$CARGO_EXECUTABLE" build \
        --manifest-path "$REPOSITORY_ROOT/Cargo.toml" \
        --package folio-ffi \
        --lib \
        --release \
        --target "$RUST_TARGET"
    LIBRARIES+=("$CARGO_TARGET_DIR/$RUST_TARGET/release/libfolio_ffi.a")
done

if [[ ${#LIBRARIES[@]} -eq 0 ]]; then
    print -u2 "没有可构建的 macOS 架构"
    exit 1
elif [[ ${#LIBRARIES[@]} -eq 1 ]]; then
    cp "${LIBRARIES[1]}" "$OUTPUT_LIBRARY"
else
    xcrun lipo -create "${LIBRARIES[@]}" -output "$OUTPUT_LIBRARY"
fi
