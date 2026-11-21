#!/bin/zsh
set -euo pipefail

# Fetches the pinned Sparkle 2.10.1 framework used for auto-updates.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="2.10.1"
DEST="$ROOT/mac/vendor"
mkdir -p "$DEST" "$ROOT/.build/sparkle"
ARCHIVE="$ROOT/.build/sparkle/Sparkle.tar.xz"
if [[ ! -f "$ARCHIVE" ]]; then
  curl -L --fail --max-time 120 -o "$ARCHIVE" "https://github.com/sparkle-project/Sparkle/releases/download/$VERSION/Sparkle-$VERSION.tar.xz"
fi
# Checksum is recorded from the pinned release asset; update only with a version bump.
SHA256="1a856d2a9edb8e628de88121d7be04cf0e2167f8641650b78fca00b14244cf27"
if ! echo "$SHA256  $ARCHIVE" | shasum -a 256 -c - >/dev/null 2>&1; then
  echo "error: Sparkle archive checksum differs from the pinned release; refusing to use it." >&2
  rm -f "$ARCHIVE"
  exit 1
fi
rm -rf "$DEST/Sparkle.framework" "$DEST/sparkle"
tar -xf "$ARCHIVE" -C "$DEST" ./Sparkle.framework
# sign_update (tools/make-appcast.sh) and generate_keys (docs/UPDATE.md) live in the archive's bin/.
mkdir -p "$DEST/sparkle"
tar -xf "$ARCHIVE" -C "$DEST/sparkle" ./bin
echo "Sparkle $VERSION installed at $DEST/Sparkle.framework (tools in $DEST/sparkle/bin)"
