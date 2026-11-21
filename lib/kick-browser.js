"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Mirrors Streamlink's own Chromium auto-detection so we can fail fast with a clear message.
function candidates(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === "darwin") {
    return ["Chromium", "Google Chrome"].flatMap(name => [`/Applications/${name}.app/Contents/MacOS/${name}`, path.join(home, "Applications", `${name}.app`, "Contents", "MacOS", name)]);
  }
  if (platform === "win32") {
    const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(Boolean);
    return roots.flatMap(root => [path.join(root, "Google", "Chrome", "Application", "chrome.exe"), path.join(root, "Microsoft", "Edge", "Application", "msedge.exe")]);
  }
  return ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/snap/bin/chromium"];
}

function findKickBrowser({ config = {}, env = process.env, platform = process.platform, exists = fs.existsSync, home } = {}) {
  const override = env.CHATCLIP_KICK_BROWSER || config.kick?.browser;
  if (override) {
    if (!path.isAbsolute(override) || !exists(override)) throw new Error(`Kick browser override does not exist: ${override}. Set CHATCLIP_KICK_BROWSER or kick.browser to the full path of Chrome or Chromium.`);
    return override;
  }
  const found = candidates(platform, env, home).find(item => exists(item));
  if (!found) throw new Error("Kick capture needs Google Chrome or Chromium (Streamlink uses it to pass Kick's browser check). Install one, or set CHATCLIP_KICK_BROWSER to its executable path.");
  return found;
}

module.exports = { findKickBrowser, candidates };
