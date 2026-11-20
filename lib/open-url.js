"use strict";

// Opens a URL in the user's default browser.
//
// On Windows `cmd /c start <url>` treats `&` in an OAuth URL as a command
// separator and silently truncates it, so rundll32 is used instead: it takes
// the URL as one argument and no shell parses it. Only http(s) URLs are
// accepted; the handler would otherwise also launch files and other protocols.

const { spawn } = require("node:child_process");

function browserCommand(url, platform = process.platform) {
  let parsed;
  try { parsed = new URL(String(url)); } catch { throw new Error("Not a valid URL."); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Only http and https URLs can be opened.");
  const href = parsed.href;
  if (platform === "darwin") return { command: "open", args: [href] };
  if (platform === "win32") return { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", href] };
  return { command: "xdg-open", args: [href] };
}

// Returns true when a launcher was started. Never throws: sign-in pages also
// print their URL, so a failed launch only means the user copies it by hand.
function openUrl(url, { platform = process.platform, spawnImpl = spawn } = {}) {
  try {
    const { command, args } = browserCommand(url, platform);
    const child = spawnImpl(command, args, { stdio: "ignore", detached: true, windowsHide: true });
    if (child && typeof child.unref === "function") child.unref();
    if (child && typeof child.on === "function") child.on("error", () => {});
    return true;
  } catch {
    return false;
  }
}

module.exports = { browserCommand, openUrl };
