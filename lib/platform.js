"use strict";

// Per-OS paths and lookups. The engine is shared by the macOS and Windows
// apps, so anything that differs between them lives here.

const os = require("node:os");
const path = require("node:path");

const APP_NAME = "Highlight Desk";

function stateDir(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.HIGHLIGHT_DESK_STATE) return path.resolve(env.HIGHLIGHT_DESK_STATE);
  if (platform === "win32") {
    const base = env.APPDATA || path.win32.join(home, "AppData", "Roaming");
    return path.win32.join(base, APP_NAME);
  }
  if (platform === "darwin") return path.posix.join(home, "Library", "Application Support", APP_NAME);
  const base = env.XDG_STATE_HOME || path.posix.join(home, ".local", "state");
  return path.posix.join(base, APP_NAME);
}

function outputRoot(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.HIGHLIGHT_DESK_OUTPUT) return path.resolve(env.HIGHLIGHT_DESK_OUTPUT);
  if (platform === "win32") return path.win32.join(env.USERPROFILE || home, "Videos", APP_NAME);
  if (platform === "darwin") return path.posix.join(home, "Movies", APP_NAME);
  return path.posix.join(home, "Videos", APP_NAME);
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

module.exports = { APP_NAME, stateDir, outputRoot, fontCandidates, ffmpegCandidates, defaultEncoder };
