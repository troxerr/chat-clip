#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BUILD_DIR="${BUILD_DIR:-$ROOT/mac/build}"
APP_DIR="$BUILD_DIR/Chatclip.app"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
ARCH="${ARCH:-$(uname -m)}"

# Homebrew Node 26 can depend on a sibling libnode dylib. Prefer the standalone
# official installation when available; never ship a binary that cannot launch.
if [[ -n "$NODE_BIN" ]] && otool -L "$NODE_BIN" 2>/dev/null | grep -q '@rpath/libnode'; then
  if [[ -x /usr/local/bin/node ]] && ! otool -L /usr/local/bin/node 2>/dev/null | grep -q '@rpath/libnode'; then
    NODE_BIN=/usr/local/bin/node
  else
    echo "Use NODE_BIN pointing to a standalone Node binary (current Node needs libnode)." >&2
    exit 1
  fi
fi

if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "Node.js 22+ is required. Install it, or set NODE_BIN=/path/to/node." >&2
  exit 1
fi

NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 22 )); then
  echo "Node.js 22+ is required (found $("$NODE_BIN" --version))." >&2
  exit 1
fi

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources/dist" "$APP_DIR/Contents/Resources/lib"

SPARKLE_FLAGS=()
SPARKLE="$ROOT/mac/vendor/Sparkle.framework"
if [[ -d "$SPARKLE" ]]; then
  SPARKLE_FLAGS=(-F "$ROOT/mac/vendor" -framework Sparkle -Wl,-rpath,@executable_path/../Frameworks)
fi
clang -arch "$ARCH" -fobjc-arc -framework Cocoa -framework QuartzCore -framework Security -framework UniformTypeIdentifiers -framework ServiceManagement -framework IOKit -framework UserNotifications -framework AVFoundation -framework AVKit -framework CoreMedia "${SPARKLE_FLAGS[@]}" "$ROOT/mac/main.m" "$ROOT/mac/ui/HDUI.m" "$ROOT/mac/ui/HDSymbols.m" "$ROOT/mac/license/HDKeychain.m" "$ROOT/mac/license/HDLicenseManager.m" -o "$APP_DIR/Contents/MacOS/Chatclip"
cp "$ROOT/mac/Info.plist" "$APP_DIR/Contents/Info.plist"
if [[ -n "${DROPBOX_APP_KEY:-}" ]]; then
  /usr/libexec/PlistBuddy -c "Set :HDDropboxAppKey $DROPBOX_APP_KEY" "$APP_DIR/Contents/Info.plist" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :HDDropboxAppKey string $DROPBOX_APP_KEY" "$APP_DIR/Contents/Info.plist"
fi
if [[ -n "${GOOGLE_CLIENT_ID:-}" ]]; then
  /usr/libexec/PlistBuddy -c "Set :HDGoogleClientId $GOOGLE_CLIENT_ID" "$APP_DIR/Contents/Info.plist" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :HDGoogleClientId string $GOOGLE_CLIENT_ID" "$APP_DIR/Contents/Info.plist"
fi
if [[ -n "${GOOGLE_CLIENT_SECRET:-}" ]]; then
  /usr/libexec/PlistBuddy -c "Set :HDGoogleClientSecret $GOOGLE_CLIENT_SECRET" "$APP_DIR/Contents/Info.plist" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :HDGoogleClientSecret string $GOOGLE_CLIENT_SECRET" "$APP_DIR/Contents/Info.plist"
fi
if [[ -n "${LICENSE_REQUIRED:-}" ]]; then
  if [[ "$LICENSE_REQUIRED" == "1" || "$LICENSE_REQUIRED" == "true" ]]; then LICENSE_BOOL=true; else LICENSE_BOOL=false; fi
  /usr/libexec/PlistBuddy -c "Set :HDLicenseRequired $LICENSE_BOOL" "$APP_DIR/Contents/Info.plist" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :HDLicenseRequired bool $LICENSE_BOOL" "$APP_DIR/Contents/Info.plist"
fi
if [[ -n "${TRIAL_DAYS:-}" ]]; then
  /usr/libexec/PlistBuddy -c "Set :HDTrialDays $TRIAL_DAYS" "$APP_DIR/Contents/Info.plist" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :HDTrialDays integer $TRIAL_DAYS" "$APP_DIR/Contents/Info.plist"
fi
if [[ -n "${CHECKOUT_URL:-}" ]]; then
  /usr/libexec/PlistBuddy -c "Set :HDCheckoutURL $CHECKOUT_URL" "$APP_DIR/Contents/Info.plist" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :HDCheckoutURL string $CHECKOUT_URL" "$APP_DIR/Contents/Info.plist"
fi
if [[ -n "${LEMON_PRODUCT_ID:-}" ]]; then
  /usr/libexec/PlistBuddy -c "Set :HDProductId $LEMON_PRODUCT_ID" "$APP_DIR/Contents/Info.plist" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :HDProductId string $LEMON_PRODUCT_ID" "$APP_DIR/Contents/Info.plist"
fi
if [[ -n "${LEMON_API_BASE:-}" ]]; then
  /usr/libexec/PlistBuddy -c "Set :HDLicenseApiBase $LEMON_API_BASE" "$APP_DIR/Contents/Info.plist" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :HDLicenseApiBase string $LEMON_API_BASE" "$APP_DIR/Contents/Info.plist"
fi
if [[ -n "${SU_FEED_URL:-}" ]]; then
  /usr/libexec/PlistBuddy -c "Set :SUFeedURL $SU_FEED_URL" "$APP_DIR/Contents/Info.plist" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :SUFeedURL string $SU_FEED_URL" "$APP_DIR/Contents/Info.plist"
fi
if [[ -n "${SU_PUBLIC_ED_KEY:-}" ]]; then
  /usr/libexec/PlistBuddy -c "Set :SUPublicEDKey $SU_PUBLIC_ED_KEY" "$APP_DIR/Contents/Info.plist" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :SUPublicEDKey string $SU_PUBLIC_ED_KEY" "$APP_DIR/Contents/Info.plist"
fi
plutil -lint "$APP_DIR/Contents/Info.plist" >/dev/null

cp "$ROOT/background.cjs" "$APP_DIR/Contents/Resources/background.cjs"
cp "$ROOT/vod.cjs" "$APP_DIR/Contents/Resources/vod.cjs"
mkdir -p "$APP_DIR/Contents/Resources/tools"
cp "$ROOT/docs/THIRD_PARTY_NOTICES.md" "$APP_DIR/Contents/Resources/THIRD_PARTY_NOTICES.md"
cp "$ROOT/tools/oauth-bridge.js" "$ROOT/tools/license.js" "$ROOT/tools/review-export.js" "$APP_DIR/Contents/Resources/tools/"
cp "$ROOT/dist/config.js" "$ROOT/dist/irc.js" "$ROOT/dist/reactions.js" "$APP_DIR/Contents/Resources/dist/"
cp "$ROOT/lib/manifest.js" "$ROOT/lib/exporter.js" "$ROOT/lib/appconfig.js" "$ROOT/lib/reframe.js" "$ROOT/lib/encoder.js" "$ROOT/lib/dropbox.js" "$ROOT/lib/google-drive.js" "$ROOT/lib/jobstore.js" "$ROOT/lib/twitch-vod.js" "$ROOT/lib/vodscan.js" "$ROOT/lib/overlays.js" "$ROOT/lib/captions.js" "$ROOT/lib/feedback.js" "$APP_DIR/Contents/Resources/lib/"
cp -R "$ROOT/lib/storage" "$APP_DIR/Contents/Resources/lib/"
cp "$ROOT/lib/stream-source.js" "$ROOT/lib/kick-chat.js" "$ROOT/lib/freetier.js" "$APP_DIR/Contents/Resources/lib/"
cp -R "$ROOT/lib/assets" "$APP_DIR/Contents/Resources/lib/"
cp "$ROOT/lib/monitor.js" "$ROOT/lib/monitor-worker.js" "$ROOT/lib/monitor-policy.js" "$APP_DIR/Contents/Resources/lib/"
cp "$ROOT/tools/monitor.js" "$APP_DIR/Contents/Resources/tools/"
if lipo -info "$NODE_BIN" 2>/dev/null | grep -q 'Architectures in the fat file'; then
  lipo "$NODE_BIN" -thin "$ARCH" -output "$APP_DIR/Contents/Resources/node"
else
  cp "$NODE_BIN" "$APP_DIR/Contents/Resources/node"
fi
chmod +x "$APP_DIR/Contents/Resources/node"
"$APP_DIR/Contents/Resources/node" --version >/dev/null

RUNTIME="$ROOT/mac/runtime/$ARCH"
if [[ -d "$RUNTIME" ]]; then
  cp -R "$RUNTIME" "$APP_DIR/Contents/Resources/runtime"
else
  echo "warning: no bundled runtime at mac/runtime/$ARCH; the app will use PATH for streamlink/ffmpeg." >&2
fi

if [[ -d "$SPARKLE" ]]; then
  mkdir -p "$APP_DIR/Contents/Frameworks"
  cp -R "$SPARKLE" "$APP_DIR/Contents/Frameworks/"
  echo "Embedded Sparkle.framework"
else
  echo "warning: Sparkle.framework not found; auto-update is disabled." >&2
fi

if [[ -d "$ROOT/Icon/AppIcon.icon" ]] && "$ROOT/tools/make_icon.sh" "$BUILD_DIR/icon" >/dev/null 2>&1; then
  cp "$BUILD_DIR/icon/Assets.car" "$BUILD_DIR/icon/AppIcon.icns" "$APP_DIR/Contents/Resources/"
elif [[ -f "$ROOT/mac/icon.png" ]]; then
  ICONSET="$BUILD_DIR/AppIcon.iconset"
  rm -rf "$ICONSET"
  mkdir -p "$ICONSET"
  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$ROOT/mac/icon.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
    double=$((size * 2))
    sips -z "$double" "$double" "$ROOT/mac/icon.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
  done
  if ! iconutil -c icns "$ICONSET" -o "$APP_DIR/Contents/Resources/AppIcon.icns"; then
    if [[ -f "$ROOT/mac/AppIcon.icns" ]]; then
      cp "$ROOT/mac/AppIcon.icns" "$APP_DIR/Contents/Resources/AppIcon.icns"
    else
      echo "Could not generate the app icon and no prebuilt icon is available." >&2
      exit 1
    fi
  fi
  rm -rf "$ICONSET"
fi

chmod -R u+rwX,go+rX "$APP_DIR"
# Copied development assets can carry Finder metadata that invalidates signing.
xattr -cr "$APP_DIR"

if codesign --force --deep --sign - "$APP_DIR" >/dev/null 2>&1; then
  echo "Signed with an ad-hoc identity."
else
  echo "warning: ad-hoc code signing failed; the app should still run locally." >&2
fi

echo "Built: $APP_DIR"
