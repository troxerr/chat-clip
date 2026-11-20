#!/bin/zsh
set -euo pipefail

# Builds a signed Sparkle 2 appcast item for a notarized DMG.
#
#   VERSION=3.1.0 BUILD=5 \
#   DOWNLOAD_URL=https://example.com/Chatclip-3.1.0-arm64.dmg \
#   DMG="mac/build/Chatclip-3.1.0-arm64.dmg" \
#   OUTPUT=site/appcast.xml \
#   ./tools/make-appcast.sh
#
# The signing key is read from the login Keychain by default. For CI, export it
# with `generate_keys -x` and set SPARKLE_KEY_FILE to the exported file.
# Never commit the private key.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${VERSION:?Set VERSION}"
BUILD="${BUILD:?Set BUILD}"
DMG="${DMG:?Set DMG}"
DOWNLOAD_URL="${DOWNLOAD_URL:?Set DOWNLOAD_URL}"
OUTPUT="${OUTPUT:-$ROOT/site/appcast.xml}"
RELEASE_NOTES="${RELEASE_NOTES:-A new version of Chatclip is available.}"
SIGN_UPDATE="$ROOT/mac/vendor/sparkle/bin/sign_update"
[[ -x "$SIGN_UPDATE" ]] || { echo "Missing Sparkle sign_update; run tools/fetch-sparkle.sh" >&2; exit 1; }
[[ -f "$DMG" ]] || { echo "DMG not found: $DMG" >&2; exit 1; }

SIGN_ARGS=()
if [[ -n "${SPARKLE_KEY_FILE:-}" ]]; then
  SIGN_ARGS+=(--ed-key-file "$SPARKLE_KEY_FILE")
elif [[ -n "${SPARKLE_ACCOUNT:-}" ]]; then
  SIGN_ARGS+=(--account "$SPARKLE_ACCOUNT")
fi

SIGNATURE="$("$SIGN_UPDATE" "${SIGN_ARGS[@]}" -p "$DMG")"
LENGTH="$(stat -f%z "$DMG")"
PUB_DATE="$(date -u '+%a, %d %b %Y %H:%M:%S +0000')"

mkdir -p "$(dirname "$OUTPUT")"
ARCH_REQ=""
if [[ "${ARCH:-}" == "arm64" ]]; then
  ARCH_REQ="
      <sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>"
fi
ITEM_FILE="$(mktemp "${TMPDIR:-/tmp}/appcast-item.XXXXXX")"
trap 'rm -f "$ITEM_FILE"' EXIT
cat > "$ITEM_FILE" <<XML
    <item>
      <title>Chatclip ${VERSION}</title>
      <pubDate>${PUB_DATE}</pubDate>
      <sparkle:version>${BUILD}</sparkle:version>
      <sparkle:shortVersionString>${VERSION}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>13.5</sparkle:minimumSystemVersion>${ARCH_REQ}
      <description><![CDATA[${RELEASE_NOTES}]]></description>
      <enclosure url="${DOWNLOAD_URL}"
                 sparkle:edSignature="${SIGNATURE}"
                 length="${LENGTH}"
                 type="application/octet-stream"/>
    </item>
XML

# EXISTING_APPCAST: an earlier appcast to add this item to (newest first), so
# one feed carries every architecture and past release.
if [[ -n "${EXISTING_APPCAST:-}" && -s "$EXISTING_APPCAST" ]]; then
  /usr/bin/python3 - "$EXISTING_APPCAST" "$ITEM_FILE" "$OUTPUT" <<'PY'
import sys
existing, item, out = sys.argv[1:4]
text = open(existing, encoding="utf-8").read()
new = open(item, encoding="utf-8").read()
marker = text.find("<item>")
if marker < 0:
    marker = text.find("</channel>")
    if marker < 0:
        sys.exit("existing appcast has no <channel>")
else:
    marker = text.rfind("\n", 0, marker) + 1
open(out, "w", encoding="utf-8").write(text[:marker] + new + text[marker:])
PY
else
  cat > "$OUTPUT" <<XML
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"
     xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"
     xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Chatclip</title>
    <link>${DOWNLOAD_URL%/*}/</link>
    <description>Chatclip releases</description>
    <language>en</language>
$(cat "$ITEM_FILE")
  </channel>
</rss>
XML
fi

echo "Wrote $OUTPUT"
echo "Set SUFeedURL to the public URL of this appcast and SUPublicEDKey to the matching public key."
