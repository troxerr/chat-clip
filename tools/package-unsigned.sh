#!/bin/zsh
set -euo pipefail

# Packages an unsigned QA DMG or zip. Signed/notarized releases go through mac/release.sh.
#
#   ARCH=arm64 APP="mac/build/ChatClip.app" ./tools/package-unsigned.sh
#   FORMAT=zip ... ./tools/package-unsigned.sh
#
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="${ARCH:-$(uname -m)}"
APP="${APP:-$ROOT/mac/build/ChatClip.app}"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null || echo 0.0.0)"
FORMAT="${FORMAT:-dmg}"

[[ -d "$APP" ]] || { echo "App bundle not found: $APP" >&2; exit 1; }
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/chatclip-package.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

if [[ "$FORMAT" == "zip" ]]; then
  OUT="${OUT:-$ROOT/mac/build/ChatClip-$VERSION-$ARCH-unsigned.zip}"
  rm -f "$OUT"
  /usr/bin/ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUT"
else
  OUT="${OUT:-$ROOT/mac/build/ChatClip-$VERSION-$ARCH-unsigned.dmg}"
  rm -f "$OUT"
  hdiutil create -volname "ChatClip" -srcfolder "$STAGE" -ov -format UDZO "$OUT" >/dev/null
fi
echo "Wrote $OUT"
