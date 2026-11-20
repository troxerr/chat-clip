#!/bin/zsh
# Compile Icon/AppIcon.icon into Assets.car + AppIcon.icns with actool.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/mac/build/icon}"
mkdir -p "$OUT"
xcrun actool "$ROOT/Icon/AppIcon.icon" --compile "$OUT" \
  --output-format human-readable-text --notices --warnings --errors \
  --output-partial-info-plist "$OUT/partial.plist" \
  --app-icon AppIcon --include-all-app-icons \
  --target-device mac --minimum-deployment-target 26.0 --platform macosx >/dev/null
[[ -f "$OUT/Assets.car" ]] || { echo "actool wrote no Assets.car (is the folder named AppIcon.icon?)" >&2; exit 1; }
[[ -f "$OUT/AppIcon.icns" ]] || { echo "actool wrote no AppIcon.icns" >&2; exit 1; }
echo "wrote $OUT/Assets.car and $OUT/AppIcon.icns"
