"use strict";

// Small rules the recorder uses to notice and recover from a stuck capture.
// Pure functions so they can be tested without spawning ffmpeg.

const STALL_MS = 30000;          // no new video for this long, after video had been flowing
const RESTART_BASE_MS = 15000;   // first wait before relaunching the recorder
const RESTART_MAX_MS = 300000;   // never wait longer than five minutes
const HEALTHY_MEDIA_SECONDS = 10; // this much video in a run counts as a healthy run

// Wait before the next relaunch: 15 s, 30 s, 60 s, 120 s, then 5 min.
function restartDelay(failures, base = RESTART_BASE_MS, max = RESTART_MAX_MS) {
  const n = Math.max(0, Math.min(Math.floor(Number(failures) || 0), 16));
  return Math.min(base * 2 ** n, max);
}

// True when video was flowing in this run and then stopped for too long.
// A run that never produced video (an offline channel) is not a stall: the
// source is still waiting for the stream to start.
function isStalled({ hasEncoder, restarting = false, stopping = false, lastFrameAt = 0, now = Date.now(), stallMs = STALL_MS } = {}) {
  if (!hasEncoder || restarting || stopping) return false;
  if (!lastFrameAt) return false;
  return now - lastFrameAt > stallMs;
}

module.exports = { STALL_MS, RESTART_BASE_MS, RESTART_MAX_MS, HEALTHY_MEDIA_SECONDS, restartDelay, isStalled };
