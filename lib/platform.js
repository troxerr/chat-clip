"use strict";

// Per-OS paths and lookups. The engine is shared by the macOS and Windows
// apps, so anything that differs between them lives here.

const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { LEGACY_APP_NAME, withLegacyEnv } = require("./legacy.js");

const APP_NAME = "ChatClip";

function stateDir(env = process.env, platform = process.platform, home = os.homedir(), name = APP_NAME) {
  env = withLegacyEnv(env);
  if (env.CHATCLIP_STATE && name === APP_NAME) return path.resolve(env.CHATCLIP_STATE);
  if (platform === "win32") {
    const base = env.APPDATA || path.win32.join(home, "AppData", "Roaming");
    return path.win32.join(base, name);
  }
  if (platform === "darwin") return path.posix.join(home, "Library", "Application Support", name);
  const base = env.XDG_STATE_HOME || path.posix.join(home, ".local", "state");
  return path.posix.join(base, name);
}

// Where the pre-rename ("Highlight Desk") state directory lives for this platform.
function legacyStateDir(env = process.env, platform = process.platform, home = os.homedir()) {
  return stateDir(env, platform, home, LEGACY_APP_NAME);
}

function outputRoot(env = process.env, platform = process.platform, home = os.homedir(), exists = fs.existsSync) {
  env = withLegacyEnv(env);
  if (env.CHATCLIP_OUTPUT) return path.resolve(env.CHATCLIP_OUTPUT);
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  const base = platform === "win32" ? join(env.USERPROFILE || home, "Videos") : join(home, platform === "darwin" ? "Movies" : "Videos");
  const current = join(base, APP_NAME);
  // Clips already saved under the old name stay where they are (history records their paths).
  const legacy = join(base, LEGACY_APP_NAME);
  return !exists(current) && exists(legacy) ? legacy : current;
}

function fontCandidates(platform = process.platform, env = process.env) {
  if (platform === "win32") {
    const root = env.SystemRoot || env.windir || "C:\\Windows";
    return ["arialbd.ttf", "ariblk.ttf", "arial.ttf", "segoeuib.ttf"].map((f) => path.win32.join(root, "Fonts", f));
  }
  if (platform === "darwin") {
    return [
      "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
      "/Library/Fonts/Arial Bold.ttf",
      "/System/Library/Fonts/Supplemental/Arial Black.ttf",
      "/System/Library/Fonts/Helvetica.ttc"
    ];
  }
  return [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf"
  ];
}

// FFmpeg builds to try, in order, when a feature (drawtext, subtitles) is needed.
function ffmpegCandidates(platform = process.platform) {
  if (platform === "darwin") {
    return ["ffmpeg", "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg", "/usr/local/opt/ffmpeg-full/bin/ffmpeg"];
  }
  return ["ffmpeg"];
}

// Encoder used when the config does not name one. Windows has no single
// hardware encoder, so it probes (see lib/encoder.js).
function defaultEncoder(platform = process.platform) {
  return platform === "darwin" ? "h264_videotoolbox" : "auto";
}

module.exports = { APP_NAME, stateDir, legacyStateDir, outputRoot, fontCandidates, ffmpegCandidates, defaultEncoder };
