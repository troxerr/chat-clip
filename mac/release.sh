#!/bin/zsh
set -euo pipefail

# Release helper. Requires an Apple Developer ID Application identity and a
# notarytool keychain profile (or Apple ID credentials).
#
#   DEVELOPER_ID_APPLICATION="Developer ID Application: Name (TEAMID)" \
#   NOTARY_PROFILE="chatclip-notary" \
#   ./mac/release.sh
#
# The app is currently ad-hoc signed by mac/build.sh; this script re-signs the
# nested executables and the app with the real identity, notarizes, staples,
# and creates a DMG.
#
#   ./mac/release.sh --check            before signing: identity, notary credentials,
#                                        runtime, Sparkle, license and OAuth config
#   ./mac/release.sh                    sign, notarize, staple
#   ./mac/release.sh --verify [DMG]     after notarizing: stapled ticket and Gatekeeper
#
# mac/build.sh reads SU_FEED_URL, SU_PUBLIC_ED_KEY, LICENSE_REQUIRED, LEMON_PRODUCT_ID,
# CHECKOUT_URL, DROPBOX_APP_KEY, GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET; this script
# only checks that they ended up in the built Info.plist.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP_DIR="$ROOT/mac/build/ChatClip.app"
ENTITLEMENTS="$ROOT/mac/ChatClip.entitlements"
IDENTITY="${DEVELOPER_ID_APPLICATION:-}"
NOTARY_PROFILE="${NOTARY_PROFILE:-}"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$ROOT/mac/Info.plist" 2>/dev/null || echo 0.0.0)"
ARCH="${ARCH:-$(uname -m)}"

if [[ "${1:-}" == "--check" ]]; then
  failures=0
  pass() { echo "  PASS  $1"; }
  fail() { echo "  FAIL  $1"; failures=$((failures + 1)); }
  plist() { /usr/libexec/PlistBuddy -c "Print :$1" "$APP_DIR/Contents/Info.plist" 2>/dev/null || true; }
  [[ -f "$APP_DIR/Contents/Info.plist" ]] || plist() { :; }

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
  [[ "$(plist SUFeedURL)" == https://* && "$(plist SUFeedURL)" != *localhost* && "$(plist SUFeedURL)" != *127.0.0.1* ]] && pass "SUFeedURL is a public HTTPS URL" || fail "SUFeedURL missing, not HTTPS, or local"
  [[ -n "$(plist SUPublicEDKey)" ]] && pass "SUPublicEDKey configured" || fail "SUPublicEDKey missing"
  [[ "$(plist HDLicenseRequired)" == "true" ]] && pass "license enforcement enabled" || fail "HDLicenseRequired is not true"
  [[ -n "$(plist HDProductId)" ]] && pass "license product ID configured" || fail "HDProductId missing"
  [[ -n "$(plist HDCheckoutURL)" ]] && pass "checkout URL configured" || fail "HDCheckoutURL missing"
  [[ -n "$(plist HDDropboxAppKey)" ]] && pass "Dropbox OAuth client configured" || fail "HDDropboxAppKey missing"
  [[ -n "$(plist HDGoogleClientId)" ]] && pass "Google OAuth client ID configured" || fail "HDGoogleClientId missing"
  [[ -n "$(plist HDGoogleClientSecret)" ]] && pass "Google OAuth client secret configured" || fail "HDGoogleClientSecret missing"
  if [[ -d "$APP_DIR" ]] && codesign --verify --deep --strict "$APP_DIR" >/dev/null 2>&1; then pass "bundle signature verifies"; else fail "bundle signature does not verify"; fi

  if (( failures > 0 )); then
    echo "\n$failures preflight check(s) failed. Do not sign or publish this build."
    exit 1
  fi
  echo "\nPreflight passed. Sign and notarize with ./mac/release.sh, then run ./mac/release.sh --verify."
  exit 0
fi

if [[ "${1:-}" == "--verify" ]]; then
  VERIFY_DMG="${2:-$ROOT/mac/build/ChatClip-$VERSION-$ARCH.dmg}"
  failures=0
  pass() { echo "  PASS  $1"; }
  fail() { echo "  FAIL  $1"; failures=$((failures + 1)); }
  echo "Post-notarization verification"
  echo "  dmg: $VERIFY_DMG"
  if [[ ! -f "$VERIFY_DMG" ]]; then
    fail "DMG missing (run ./mac/release.sh first)"
  else
    xcrun stapler validate "$VERIFY_DMG" >/dev/null 2>&1 && pass "notarization ticket stapled" || fail "no valid stapled ticket"
    spctl -a -t open --context context:primary-signature "$VERIFY_DMG" >/dev/null 2>&1 && pass "Gatekeeper accepts the DMG" || fail "Gatekeeper rejects the DMG"
    VERIFY_MOUNT="$(mktemp -d "${TMPDIR:-/tmp}/chatclip-verify.XXXXXX")"
    if hdiutil attach "$VERIFY_DMG" -nobrowse -readonly -mountpoint "$VERIFY_MOUNT" >/dev/null 2>&1; then
      codesign --verify --deep --strict "$VERIFY_MOUNT/ChatClip.app" >/dev/null 2>&1 && pass "app signature verifies" || fail "app signature does not verify"
      spctl -a -t exec "$VERIFY_MOUNT/ChatClip.app" >/dev/null 2>&1 && pass "Gatekeeper accepts the app" || fail "Gatekeeper rejects the app"
      hdiutil detach "$VERIFY_MOUNT" >/dev/null 2>&1 || true
    else
      fail "could not mount the DMG"
    fi
    rmdir "$VERIFY_MOUNT" 2>/dev/null || true
  fi
  if (( failures > 0 )); then
    echo "\n$failures verification check(s) failed. Do not publish this build."
    exit 1
  fi
  echo "\nVerification passed."
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
    case "$file" in */*.xpc/*|*/*.app/*) continue ;; esac  # sealed with their bundle below
    if file "$file" | grep -q "Mach-O"; then
      sign "$file"
    fi
  done < <(find "$APP_DIR/Contents/Frameworks" -type f -print0)
  # Sparkle's helper bundles (XPC services, Updater.app) are sealed inside-out,
  # deepest first, before the framework itself. Keep their own entitlements.
  while IFS= read -r -d '' bundle; do
    codesign --force --options runtime --timestamp --preserve-metadata=entitlements --sign "$IDENTITY" "$bundle"
  done < <(find "$APP_DIR/Contents/Frameworks" -depth -type d \( -name "*.xpc" -o -name "*.app" \) -print0)
  while IFS= read -r -d '' bundle; do
    sign "$bundle"
  done < <(find "$APP_DIR/Contents/Frameworks" -depth -type d -name "*.framework" -print0)
fi

echo "Signing the app…"
codesign --force --options runtime --timestamp --sign "$IDENTITY" --entitlements "$ENTITLEMENTS" "$APP_DIR"
codesign --verify --deep --strict --verbose=2 "$APP_DIR"

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/chatclip-dmg.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP_DIR" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
DMG="$ROOT/mac/build/ChatClip-$VERSION-$ARCH.dmg"
rm -f "$DMG"
hdiutil create -volname "ChatClip" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
codesign --force --timestamp --sign "$IDENTITY" "$DMG"

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
spctl -a -t exec -vv "$MOUNT/ChatClip.app"
hdiutil detach "$MOUNT" >/dev/null
rmdir "$MOUNT" 2>/dev/null || true

echo "Release DMG: $DMG"

echo "Next: ./mac/release.sh --verify \"$DMG\""
echo "Then publish with the signed appcast item:"
echo "  ARCH=$ARCH VERSION=$VERSION BUILD=<CFBundleVersion> DOWNLOAD_URL=<public dmg url> DMG=\"$DMG\" ./tools/make-appcast.sh"
echo "SUFeedURL and SUPublicEDKey are set at build time (SU_FEED_URL, SU_PUBLIC_ED_KEY for mac/build.sh)."
