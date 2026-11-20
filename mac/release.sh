#!/bin/zsh
set -euo pipefail

# Release helper. Requires an Apple Developer ID Application identity and a
# notarytool keychain profile (or Apple ID credentials).
#
#   DEVELOPER_ID_APPLICATION="Developer ID Application: Name (TEAMID)" \
#   NOTARY_PROFILE="highlightdesk-notary" \
#   ./mac/release.sh
#
# The app is currently ad-hoc signed by mac/build.sh; this script re-signs the
# nested executables and the app with the real identity, notarizes, staples,
# and creates a DMG.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP_DIR="$ROOT/mac/build/Chatclip.app"
ENTITLEMENTS="$ROOT/mac/Chatclip.entitlements"
IDENTITY="${DEVELOPER_ID_APPLICATION:-}"
NOTARY_PROFILE="${NOTARY_PROFILE:-}"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$ROOT/mac/Info.plist" 2>/dev/null || echo 0.0.0)"
ARCH="${ARCH:-$(uname -m)}"

if [[ "${1:-}" == "--check" ]]; then
  failures=0
  pass() { echo "  PASS  $1"; }
  fail() { echo "  FAIL  $1"; failures=$((failures + 1)); }
  plist() { /usr/libexec/PlistBuddy -c "Print :$1" "$APP_DIR/Contents/Info.plist" 2>/dev/null || true; }

  echo "Release preflight"
  echo "  app: $APP_DIR"
  [[ -d "$APP_DIR" ]] && pass "app bundle exists" || fail "app bundle missing (run npm run build:mac)"
  [[ -n "$IDENTITY" ]] && pass "DEVELOPER_ID_APPLICATION set" || fail "DEVELOPER_ID_APPLICATION not set"
  if [[ -n "$IDENTITY" ]] && security find-identity -v -p codesigning 2>/dev/null | grep -Fq "$IDENTITY"; then
    pass "Developer ID signing identity installed"
  else
    fail "Developer ID signing identity not installed"
  fi
  [[ -n "$NOTARY_PROFILE" || ( -n "${APPLE_API_KEY_PATH:-}" && -n "${APPLE_API_KEY_ID:-}" && -n "${APPLE_API_ISSUER_ID:-}" ) || ( -n "${APPLE_ID:-}" && -n "${TEAM_ID:-}" && -n "${APP_PASSWORD:-}" ) ]] && pass "notary credentials configured" || fail "NOTARY_PROFILE or Apple ID credentials not configured"
  [[ -x "$ROOT/mac/runtime/$ARCH/bin/ffmpeg" ]] && pass "bundled FFmpeg ($ARCH)" || fail "bundled FFmpeg missing for $ARCH (run tools/build-runtime.sh)"
  [[ -x "$ROOT/mac/runtime/$ARCH/bin/streamlink" ]] && pass "bundled Streamlink ($ARCH)" || fail "bundled Streamlink missing for $ARCH"
  [[ -d "$APP_DIR/Contents/Frameworks/Sparkle.framework" ]] && pass "Sparkle framework embedded" || fail "Sparkle framework missing"
  [[ -n "$(plist SUFeedURL)" ]] && pass "SUFeedURL configured" || fail "SUFeedURL missing"
  [[ -n "$(plist SUPublicEDKey)" ]] && pass "SUPublicEDKey configured" || fail "SUPublicEDKey missing"
  [[ "$(plist HDLicenseRequired)" == "true" ]] && pass "license enforcement enabled" || fail "HDLicenseRequired is not true"
  [[ -n "$(plist HDProductId)" ]] && pass "Lemon product ID configured" || fail "HDProductId missing"
  [[ -n "$(plist HDCheckoutURL)" ]] && pass "checkout URL configured" || fail "HDCheckoutURL missing"
  [[ -n "$(plist HDDropboxAppKey)" ]] && pass "Dropbox OAuth client configured" || fail "HDDropboxAppKey missing"
  [[ -n "$(plist HDGoogleClientId)" ]] && pass "Google OAuth client ID configured" || fail "HDGoogleClientId missing"
  [[ -n "$(plist HDGoogleClientSecret)" ]] && pass "Google OAuth client secret configured" || fail "HDGoogleClientSecret missing"
  if [[ -d "$APP_DIR" ]] && codesign --verify --deep --strict "$APP_DIR" >/dev/null 2>&1; then pass "bundle signature verifies"; else fail "bundle signature does not verify"; fi
  if [[ -d "$APP_DIR" ]] && spctl -a -t exec "$APP_DIR" >/dev/null 2>&1; then pass "Gatekeeper accepts the app"; else fail "Gatekeeper rejects the app (notarize first)"; fi

  if (( failures > 0 )); then
    echo "\n$failures preflight check(s) failed. Do not publish this build."
    exit 1
  fi
  echo "\nPreflight passed. Notarized release is ready to publish."
  exit 0
fi

if [[ -z "$IDENTITY" ]]; then
  echo "Set DEVELOPER_ID_APPLICATION to your Developer ID Application identity." >&2
  echo "Install it from your Apple Developer account first." >&2
  exit 1
fi

if ! security find-identity -v -p codesigning 2>/dev/null | grep -Fq "$IDENTITY"; then
  echo "Signing identity not found in the keychain: $IDENTITY" >&2
  exit 1
fi

if [[ ! -d "$APP_DIR" ]]; then
  echo "Build the app first: npm run build:mac" >&2
  exit 1
fi

if [[ ! -f "$ENTITLEMENTS" ]]; then
  echo "Missing entitlements file: $ENTITLEMENTS" >&2
  exit 1
fi

sign() {
  codesign --force --options runtime --timestamp --sign "$IDENTITY" "$1"
}

echo "Signing nested executables and libraries…"
while IFS= read -r -d '' file; do
  if file "$file" | grep -q "Mach-O"; then
    sign "$file"
  fi
done < <(find "$APP_DIR/Contents/Resources" -type f -print0)

if [[ -d "$APP_DIR/Contents/Frameworks" ]]; then
  while IFS= read -r -d '' file; do
    if file "$file" | grep -q "Mach-O"; then
      sign "$file"
    fi
  done < <(find "$APP_DIR/Contents/Frameworks" -type f -print0)
  while IFS= read -r -d '' bundle; do
    sign "$bundle"
  done < <(find "$APP_DIR/Contents/Frameworks" -type d -name "*.framework" -print0)
fi

echo "Signing the app…"
codesign --force --options runtime --timestamp --sign "$IDENTITY" --entitlements "$ENTITLEMENTS" "$APP_DIR"
codesign --verify --deep --strict --verbose=2 "$APP_DIR"

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/chatclip-dmg.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP_DIR" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
DMG="$ROOT/mac/build/Chatclip-$VERSION-$ARCH.dmg"
rm -f "$DMG"
hdiutil create -volname "Chatclip" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
codesign --force --sign "$IDENTITY" "$DMG"

echo "Notarizing $DMG…"
if [[ -n "$NOTARY_PROFILE" ]]; then
  xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
elif [[ -n "${APPLE_API_KEY_PATH:-}" && -n "${APPLE_API_KEY_ID:-}" && -n "${APPLE_API_ISSUER_ID:-}" ]]; then
  xcrun notarytool submit "$DMG" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER_ID" --wait
elif [[ -n "${APPLE_ID:-}" && -n "${TEAM_ID:-}" && -n "${APP_PASSWORD:-}" ]]; then
  xcrun notarytool submit "$DMG" --apple-id "$APPLE_ID" --team-id "$TEAM_ID" --password "$APP_PASSWORD" --wait
else
  echo "Set NOTARY_PROFILE, APPLE_API_KEY_PATH + APPLE_API_KEY_ID + APPLE_API_ISSUER_ID, or APPLE_ID + TEAM_ID + APP_PASSWORD." >&2
  echo "DMG created but not notarized: $DMG" >&2
  exit 1
fi

xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"
spctl -a -t open --context context:primary-signature -vv "$DMG"

MOUNT="$(mktemp -d "${TMPDIR:-/tmp}/chatclip-mount.XXXXXX")"
hdiutil attach "$DMG" -nobrowse -mountpoint "$MOUNT" >/dev/null
spctl -a -t exec -vv "$MOUNT/Chatclip.app"
hdiutil detach "$MOUNT" >/dev/null
rmdir "$MOUNT" 2>/dev/null || true

echo "Release DMG: $DMG"

if [[ -n "${SU_FEED_URL:-}" && -n "${SPARKLE_PUBLIC_KEY:-}" ]]; then
  echo "Sparkle feed URL configured: $SU_FEED_URL"
  echo "Generate/sign the appcast with:"
  echo "  VERSION=$VERSION BUILD=<CFBundleVersion> DOWNLOAD_URL=<public dmg url> DMG=\"$DMG\" ./tools/make-appcast.sh"
  echo "and set SUFeedURL=$SU_FEED_URL, SUPublicEDKey=$SPARKLE_PUBLIC_KEY at build time."
fi
