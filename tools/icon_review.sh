#!/bin/zsh
# Render Icon/AppIcon.icon in each look with ictool for review.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ICTOOL="$(xcode-select -p)/../Applications/Icon Composer.app/Contents/Executables/ictool"
OUT="${1:-/private/tmp/chatclip-icon}"
mkdir -p "$OUT"
for look in Default Dark TintedLight ClearLight; do
  "$ICTOOL" "$ROOT/Icon/AppIcon.icon" --export-image --output-file "$OUT/$look.png" \
    --platform macOS --rendition "$look" --width 512 --height 512 --scale 1 >/dev/null
done
"$ICTOOL" "$ROOT/Icon/AppIcon.icon" --export-image --output-file "$OUT/small.png" \
  --platform macOS --rendition Default --width 32 --height 32 --scale 1 >/dev/null
echo "wrote $OUT"
