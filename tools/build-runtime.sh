#!/bin/zsh
set -euo pipefail

# Builds the per-architecture runtime embedded in the app:
#   - FFmpeg 7.1.1, LGPL, static, VideoToolbox/AudioToolbox
#   - Streamlink 8.6.2, PyInstaller onefile, Python 3.12
# Then copies both into mac/runtime/<arch>/bin.
#
#   ./tools/build-runtime.sh
#
# Requires Xcode command-line tools, make, curl, python3.12, and network access.
# Set FORCE=1 to rebuild an existing FFmpeg/Streamlink artifact.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="${ARCH:-$(uname -m)}"
BUILD="$ROOT/.build/runtime-$ARCH"
FFMPEG_VERSION="7.1.1"
FFMPEG_SHA256="733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1"
STREAMLINK_VERSION="8.6.2"
PYINSTALLER_VERSION="6.14.2"
PYTHON_BIN="${PYTHON:-python3.12}"

mkdir -p "$BUILD/logs"
cd "$BUILD"

if [[ ! -x "$BUILD/ffmpeg-install/bin/ffmpeg" || "${FORCE:-0}" == "1" ]]; then
  if [[ ! -f "$BUILD/ffmpeg.tar.xz" || "${FORCE:-0}" == "1" ]]; then
    echo "Downloading FFmpeg $FFMPEG_VERSION…"
    curl -L --fail --max-time 180 -o "$BUILD/ffmpeg.tar.xz" "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz"
  fi
  echo "$FFMPEG_SHA256  $BUILD/ffmpeg.tar.xz" | shasum -a 256 -c -
  rm -rf "$BUILD/ffmpeg-src"
  mkdir -p "$BUILD/ffmpeg-src"
  tar -xf "$BUILD/ffmpeg.tar.xz" -C "$BUILD/ffmpeg-src" --strip-components=1
  cd "$BUILD/ffmpeg-src"
  # --disable-gpl removes boxblur/libx264; the app uses gblur + VideoToolbox.
  ./configure \
    --prefix="$BUILD/ffmpeg-install" \
    --target-os=darwin --arch="$ARCH" \
    --disable-gpl --disable-nonfree --disable-autodetect --disable-x86asm \
    --disable-doc --disable-debug --disable-ffplay \
    --enable-static --disable-shared \
    --enable-videotoolbox --enable-audiotoolbox \
    > "$BUILD/logs/ffmpeg-configure.log" 2>&1
  make -j4 > "$BUILD/logs/ffmpeg-make.log" 2>&1
  make install >> "$BUILD/logs/ffmpeg-make.log" 2>&1
  cd "$BUILD"
fi

if [[ ! -x "$BUILD/streamlink-dist/streamlink" || "${FORCE:-0}" == "1" ]]; then
  rm -rf "$BUILD/streamlink-venv" "$BUILD/streamlink-dist" "$BUILD/streamlink-work"
  "$PYTHON_BIN" -m venv "$BUILD/streamlink-venv"
  "$BUILD/streamlink-venv/bin/pip" install --upgrade pip > "$BUILD/logs/streamlink-pip.log" 2>&1
  "$BUILD/streamlink-venv/bin/pip" install "streamlink==$STREAMLINK_VERSION" "pyinstaller==$PYINSTALLER_VERSION" >> "$BUILD/logs/streamlink-pip.log" 2>&1
  PYTHON_DYLIB="$("$BUILD/streamlink-venv/bin/python" - <<'PY'
import os, sysconfig
libdir = sysconfig.get_config_var("LIBDIR")
for name in ("libpython3.12.dylib", "libpython3.dylib", "Python"):
    candidate = os.path.join(libdir, name)
    if os.path.exists(candidate):
        print(os.path.realpath(candidate))
        break
PY
)"
  if [[ -z "$PYTHON_DYLIB" || ! -f "$PYTHON_DYLIB" ]]; then
    echo "Could not find the Python shared library. Use a Python with a shared libpython." >&2
    exit 1
  fi
  PYINSTALLER_CONFIG_DIR="$BUILD/pyinstaller-cache" "$BUILD/streamlink-venv/bin/pyinstaller" \
    --noconfirm --clean --onefile --name streamlink \
    --workpath "$BUILD/streamlink-work" --distpath "$BUILD/streamlink-dist" --specpath "$BUILD" \
    --collect-all streamlink --collect-all streamlink_cli \
    --add-binary "$PYTHON_DYLIB:_internal" \
    --paths "$BUILD/streamlink-venv/lib/python3.12/site-packages" \
    "$BUILD/streamlink-venv/bin/streamlink" > "$BUILD/logs/streamlink-pyinstaller.log" 2>&1
fi

"$BUILD/streamlink-dist/streamlink" --version >/dev/null
"$BUILD/ffmpeg-install/bin/ffmpeg" -version >/dev/null

FFMPEG_BIN="$BUILD/ffmpeg-install/bin/ffmpeg" \
STREAMLINK_BIN="$BUILD/streamlink-dist/streamlink" \
"$ROOT/tools/prepare-runtime.sh"

echo "Runtime ready for $ARCH at $ROOT/mac/runtime/$ARCH"
