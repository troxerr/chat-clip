"use strict";

// Lowers the CPU priority of the clip-encoding FFmpeg children so exports do
// not steal time from the game and the streaming software running alongside
// the app. The live recorder only stream-copies, so it stays at normal priority.
//
// This affects CPU scheduling only. GPU encoders (NVENC, QSV, AMF) still share
// the GPU with the game.

const os = require("node:os");

const LEVELS = new Set(["normal", "belowNormal"]);

// Order: HIGHLIGHT_DESK_PRIORITY, then the config value, then the platform
// default (below normal on Windows, where it shares a PC with a game; normal elsewhere).
function resolvePriority(setting, env = process.env, platform = process.platform) {
  const fromEnv = String(env.HIGHLIGHT_DESK_PRIORITY || "");
  if (LEVELS.has(fromEnv)) return fromEnv;
  if (LEVELS.has(setting)) return setting;
  return platform === "win32" ? "belowNormal" : "normal";
}

function normalizedPriority(value) {
  return LEVELS.has(value) ? value : undefined;
}

// Returns true when the priority was changed. Never throws: a child that has
// already exited, or a refused request, just keeps normal priority.
function applyPriority(child, setting, { env = process.env, platform = process.platform, setPriority = os.setPriority } = {}) {
  if (!child || !child.pid) return false;
  if (resolvePriority(setting, env, platform) !== "belowNormal") return false;
  try {
    setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    return true;
  } catch {
    return false;
  }
}

module.exports = { LEVELS, resolvePriority, normalizedPriority, applyPriority };
