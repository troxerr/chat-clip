"use strict";

// Free plan: FREE_WEEKLY_CLIPS clean clips per calendar week (Monday 00:00 local),
// after that clips are watermarked. Usage is a small JSON file in the state
// directory. It is a speed bump, not DRM: a user can edit the file.

const fs = require("node:fs");
const path = require("node:path");

const FREE_WEEKLY_CLIPS = 3;
const WATERMARK_SOURCE = path.join(__dirname, "assets", "watermark.pam");

function currentPlan(env = process.env) {
  return String(env.HIGHLIGHT_DESK_PLAN || "").toLowerCase() === "free" ? "free" : "pro";
}

// Monday 00:00 in local time for the week containing `now`.
function weekStart(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function nextWeekStart(now = new Date()) {
  const next = weekStart(now);
  next.setDate(next.getDate() + 7);
  return next;
}

function usageFile(dir) {
  return path.join(dir, "free-tier.json");
}

function readUsed(dir, now = new Date()) {
  try {
    const data = JSON.parse(fs.readFileSync(usageFile(dir), "utf8"));
    if (data && data.weekStart === weekStart(now).toISOString() && Number.isInteger(data.used) && data.used >= 0) return data.used;
  } catch {}
  return 0;
}

function status({ dir, plan = currentPlan(), limit = FREE_WEEKLY_CLIPS, now = new Date() } = {}) {
  if (plan !== "free") return { plan: "pro", limit: null, used: 0, remaining: null, watermark: false, resetsAt: null };
  const used = dir ? readUsed(dir, now) : 0;
  return {
    plan: "free",
    limit,
    used,
    remaining: Math.max(0, limit - used),
    watermark: used >= limit,
    resetsAt: nextWeekStart(now).toISOString()
  };
}

// Counts one clean (un-watermarked) clip. Never throws: a write failure must not lose a clip.
function recordClip({ dir, now = new Date() } = {}) {
  if (!dir) return false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const used = readUsed(dir, now) + 1;
    const file = usageFile(dir);
    fs.writeFileSync(file + ".tmp", JSON.stringify({ weekStart: weekStart(now).toISOString(), used }));
    fs.renameSync(file + ".tmp", file);
    return true;
  } catch {
    return false;
  }
}

// ffmpeg filter paths cannot contain spaces (the app bundle path does), so
// copy the image (PAM: the bundled ffmpeg decodes it with alpha; lib/assets/watermark.png is the editable source) into a safe temp folder once per process.
let preparedWatermark;
function prepareWatermark() {
  if (preparedWatermark !== undefined) return preparedWatermark;
  preparedWatermark = null;
  try {
    const { makeOverlayDir } = require("./overlays.js");
    const dir = makeOverlayDir();
    const file = path.join(dir, "watermark.pam");
    fs.copyFileSync(WATERMARK_SOURCE, file);
    preparedWatermark = { file };
  } catch {}
  return preparedWatermark;
}

module.exports = { FREE_WEEKLY_CLIPS, currentPlan, weekStart, nextWeekStart, status, recordClip, prepareWatermark };
