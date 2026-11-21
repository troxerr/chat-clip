#!/bin/zsh
set -euo pipefail

# Builds a signed Sparkle 2 appcast item for a notarized DMG.
#
#   ARCH=arm64 VERSION=3.1.0 BUILD=5 \
#   DOWNLOAD_URL=https://example.com/ClipSpike-3.1.0-arm64.dmg \
#   DMG="mac/build/ClipSpike-3.1.0-arm64.dmg" \
#   OUTPUT=site/appcast.xml \
#   ./tools/make-appcast.sh
#
# ARCH (arm64 or x86_64) must be set: arm64 items get sparkle:hardwareRequirements.
# The signing key is read from the login Keychain by default. For CI, export it
# with `generate_keys -x` and set SPARKLE_KEY_FILE to the exported file.
# Never commit the private key.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${VERSION:?Set VERSION}"
BUILD="${BUILD:?Set BUILD}"
DMG="${DMG:?Set DMG}"
DOWNLOAD_URL="${DOWNLOAD_URL:?Set DOWNLOAD_URL}"
OUTPUT="${OUTPUT:-$ROOT/site/appcast.xml}"
RELEASE_NOTES="${RELEASE_NOTES:-A new version of ClipSpike is available.}"
ARCH="${ARCH:?Set ARCH to arm64 or x86_64}"
[[ "$ARCH" == "arm64" || "$ARCH" == "x86_64" ]] || { echo "ARCH must be arm64 or x86_64 (got $ARCH)" >&2; exit 1; }
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
if [[ "$ARCH" == "arm64" ]]; then
  ARCH_REQ="
      <sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>"
fi
ITEM_FILE="$(mktemp "${TMPDIR:-/tmp}/appcast-item.XXXXXX")"
trap 'rm -f "$ITEM_FILE"' EXIT
cat > "$ITEM_FILE" <<XML
    <item>
      <title>ClipSpike ${VERSION}</title>
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
# one feed carries every architecture and past release. The arm64 item carries
# sparkle:hardwareRequirements, but Intel items cannot be restricted, so an arm64
# Mac sees both items for a version. Sparkle keeps feed order for equal
# versions, so the arm64 item is always placed before the Intel item of the
# same version; set ARCH so the item is classified.
if [[ -n "${EXISTING_APPCAST:-}" && -s "$EXISTING_APPCAST" ]]; then
  /usr/bin/python3 - "$EXISTING_APPCAST" "$ITEM_FILE" "$OUTPUT" "$ARCH" <<'PY'
import re, sys
existing, item, out, arch = sys.argv[1:5]
text = open(existing, encoding="utf-8").read()
new = open(item, encoding="utf-8").read()
if not new.endswith("\n"):
    new += "\n"
item_re = re.compile(r"[ \t]*<item>.*?</item>[ \t]*\n?", re.S)
version = re.search(r"<sparkle:version>([^<]*)</sparkle:version>", new).group(1).strip()
pos = None
if arch != "arm64":
    for m in item_re.finditer(text):
        block = m.group(0)
        v = re.search(r"<sparkle:version>([^<]*)</sparkle:version>", block)
        if v and v.group(1).strip() == version and "<sparkle:hardwareRequirements>arm64<" in block:
            pos = m.end()
            if not block.endswith("\n"):
                new = "\n" + new
            break
if pos is None:
    first = text.find("<item>")
    if first < 0:
        first = text.find("</channel>")
        if first < 0:
            sys.exit("existing appcast has no <channel>")
    pos = text.rfind("\n", 0, first) + 1
open(out, "w", encoding="utf-8").write(text[:pos] + new + text[pos:])
PY
else
  cat > "$OUTPUT" <<XML
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"
     xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"
     xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>ClipSpike</title>
    <link>${DOWNLOAD_URL%/*}/</link>
    <description>ClipSpike releases</description>
    <language>en</language>
$(cat "$ITEM_FILE")
  </channel>
</rss>
XML
fi

echo "Wrote $OUTPUT"
echo "Set SUFeedURL to the public URL of this appcast and SUPublicEDKey to the matching public key."
