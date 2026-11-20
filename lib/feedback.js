"use strict";

const { stateDir } = require("./platform.js");

// Local usage log so highlight picking can learn from how clips get used.
// Everything stays on this Mac: one JSON object per line in
//   ~/Library/Application Support/Highlight Desk/feedback.jsonl
// plus review-state.json, which counts finished sessions since the last review.
//
// Event kinds:
//   session-start  { sessionId, mode: "live"|"vod", channel, vodId }
//   session-end    { sessionId, mode, channel, vodId, durationSec, clips, ... }
//   clip-created   { clipId, sessionId, mode, channel, signals: {...}, hook, captions }
//   clip-action    { clipId, action: opened|revealed|deleted|missing|uploaded|rated-up|rated-down|rating-cleared }
//
// Logging must never break clipping, so every write swallows its own errors.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const REVIEW_EVERY = 3;
const CLIP_ACTIONS = new Set(["opened", "revealed", "deleted", "missing", "uploaded", "rated-up", "rated-down", "rating-cleared", "duplicate", "started-late", "ended-early"]);

function feedbackDir(env = process.env) {
  return stateDir(env);
}

const files = (dir) => ({
  log: path.join(dir, "feedback.jsonl"),
  state: path.join(dir, "review-state.json"),
  ready: path.join(dir, "review-ready.json")
});

function append(dir, record) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.appendFileSync(files(dir).log, JSON.stringify(record) + "\n", { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

function logEvent(kind, data = {}, { dir = feedbackDir(), now = new Date() } = {}) {
  return append(dir, { v: 1, kind, at: now.toISOString(), ...data });
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file + ".tmp", JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(file + ".tmp", file);
    return true;
  } catch {
    return false;
  }
}

function emptyReviewState() {
  return { sinceReview: 0, sessions: [], lastReviewAt: null, readyAt: null };
}

function readReviewState(dir = feedbackDir()) {
  return { ...emptyReviewState(), ...readJson(files(dir).state, {}) };
}

// Opens a session and returns a handle whose end() logs session-end and
// advances the review counter. end() is safe to call more than once.
function startSession({ mode, channel = "", vodId = null, extra = {} } = {}, { dir = feedbackDir(), now = () => new Date() } = {}) {
  const sessionId = randomUUID();
  const startedAt = now();
  let clips = 0;
  let ended = null;
  logEvent("session-start", { sessionId, mode, channel, vodId, ...extra }, { dir, now: startedAt });
  return {
    sessionId,
    countClip() { clips += 1; },
    get clips() { return clips; },
    end(details = {}) {
      if (ended) return ended;
      const endedAt = now();
      const durationSec = Math.max(0, Math.round((endedAt - startedAt) / 1000));
      logEvent("session-end", { sessionId, mode, channel, vodId, durationSec, clips, ...details }, { dir, now: endedAt });
      ended = completeSession({ sessionId, mode, channel, vodId, clips, startedAt, endedAt }, { dir });
      return ended;
    }
  };
}

// Counts a finished session. Sessions that never got going (no clips and under
// a minute) don't count. Returns { count, ready } where ready is the
// review-ready payload the first time the counter reaches REVIEW_EVERY.
function completeSession({ sessionId, mode, channel, vodId, clips, startedAt, endedAt }, { dir = feedbackDir(), every = REVIEW_EVERY } = {}) {
  const durationSec = Math.round((endedAt - startedAt) / 1000);
  const state = readReviewState(dir);
  if (!clips && durationSec < 60) return { count: state.sinceReview, ready: null };
  state.sessions.push({ sessionId, mode, channel, vodId: vodId || null, clips, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString() });
  state.sinceReview = state.sessions.length;
  let ready = null;
  if (state.sinceReview >= every && !state.readyAt) {
    state.readyAt = endedAt.toISOString();
    ready = {
      sessions: state.sessions.length,
      from: state.sessions[0].startedAt,
      to: state.sessions[state.sessions.length - 1].endedAt,
      sessionIds: state.sessions.map((session) => session.sessionId),
      message: `${state.sessions.length} sessions logged. Open Capture Monitor to review your highlights.`
    };
    writeJson(files(dir).ready, ready);
  }
  writeJson(files(dir).state, state);
  return { count: state.sinceReview, ready };
}

function logClipCreated({ clipId, sessionId, mode, channel, vodId = null, vodOffsetSec = null, path: clipPath = null, signals = {}, hook = null, captions = null }, options) {
  return logEvent("clip-created", {
    clipId, sessionId, mode, channel, vodId, vodOffsetSec, path: clipPath,
    signals,
    hook: hook ? { on: true, text: hook.text || null, source: hook.source || null } : { on: false },
    captions: captions ? { on: true, cues: captions.cues ?? null } : { on: false }
  }, options);
}

function logClipAction({ clipId, action, details = {} }, options) {
  if (!clipId || !CLIP_ACTIONS.has(action)) return false;
  return logEvent("clip-action", { clipId, action, ...details }, options);
}

function readEvents(dir = feedbackDir()) {
  let text = "";
  try { text = fs.readFileSync(files(dir).log, "utf8"); } catch { return []; }
  const events = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch {}
  }
  return events;
}

function markReviewed({ dir = feedbackDir(), now = new Date() } = {}) {
  const state = { ...emptyReviewState(), lastReviewAt: now.toISOString() };
  writeJson(files(dir).state, state);
  try { fs.rmSync(files(dir).ready, { force: true }); } catch {}
  return state;
}

module.exports = {
  REVIEW_EVERY,
  CLIP_ACTIONS,
  feedbackDir,
  feedbackFiles: files,
  logEvent,
  startSession,
  completeSession,
  readReviewState,
  logClipCreated,
  logClipAction,
  readEvents,
  markReviewed
};
