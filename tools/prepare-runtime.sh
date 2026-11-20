#!/bin/zsh
set -euo pipefail

# Prepares the per-architecture runtime that mac/build.sh embeds.
# Provide self-contained binaries; Homebrew/Python-dependent binaries are rejected.
#
#   FFMPEG_BIN=/path/to/static/ffmpeg \
#   STREAMLINK_BIN=/path/to/self-contained/streamlink \
#   ./tools/prepare-runtime.sh
#
# For a commercial build use an LGPL FFmpeg build with VideoToolbox and a
# PyInstaller/standalone Streamlink binary. Do not ship libx264 in the bundle.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="${ARCH:-$(uname -m)}"
DEST="$ROOT/mac/runtime/$ARCH/bin"
FFMPEG_BIN="${FFMPEG_BIN:-$(command -v ffmpeg || true)}"
STREAMLINK_BIN="${STREAMLINK_BIN:-$(command -v streamlink || true)}"

if [[ -z "$FFMPEG_BIN" || ! -x "$FFMPEG_BIN" ]]; then
  echo "Set FFMPEG_BIN to a self-contained LGPL FFmpeg binary." >&2
  exit 1
fi
if [[ -z "$STREAMLINK_BIN" || ! -x "$STREAMLINK_BIN" ]]; then
  echo "Set STREAMLINK_BIN to a self-contained Streamlink binary." >&2
  exit 1
fi

file "$FFMPEG_BIN" | grep -q "Mach-O" || { echo "FFmpeg is not a Mach-O binary." >&2; exit 1; }
file "$STREAMLINK_BIN" | grep -q "Mach-O" || { echo "Streamlink must be a self-contained Mach-O binary (for example a PyInstaller build), not a Python script." >&2; exit 1; }

for binary in "$FFMPEG_BIN" "$STREAMLINK_BIN"; do
  if otool -L "$binary" | grep -Eq '/opt/homebrew|/usr/local|Python\.framework|/Library/Frameworks/Python'; then
    echo "Not portable: $binary links against Homebrew/Python." >&2
    otool -L "$binary" >&2
    exit 1
  fi
done

mkdir -p "$DEST"
cp "$FFMPEG_BIN" "$DEST/ffmpeg"
cp "$STREAMLINK_BIN" "$DEST/streamlink"
chmod +x "$DEST/ffmpeg" "$DEST/streamlink"

"$DEST/ffmpeg" -version >/dev/null
"$DEST/streamlink" --version >/dev/null

echo "Prepared runtime for $ARCH at $DEST"
echo "It will be copied into the app by mac/build.sh."
