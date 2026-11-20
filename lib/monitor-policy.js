"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { settingsFor, mergeSettings } = require("../dist/config.js");
const { evaluateReaction } = require("../dist/reactions.js");

const ROOT = settingsFor("desktop");
const LIMITS = { sensitivity: [0.75, 1.25], minReactionShare: [0.30, 0.40], autoCooldownMs: [270000, 330000] };
const LABELS = new Map([["rated-up", 1], ["rated-down", -1], ["duplicate", -1], ["rating-cleared", 0]]);

function channelKey(channel) {
  const key = String(channel || "").trim().toLowerCase();
  if (!/^(?:[a-z0-9_]{1,25}|kick--[a-z0-9_-]{1,25})$/.test(key)) throw new Error("A valid Twitch channel or kick--channel key is required.");
  return key;
}
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const draft = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(draft, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(draft, file);
  } finally { try { fs.unlinkSync(draft); } catch {} }
}
function profilePath(dir, channel) { return path.join(dir, "monitoring", "profiles", `${channelKey(channel)}.json`); }
function safeSettings(input = {}) {
  const result = {};
  for (const [key, [low, high]] of Object.entries(LIMITS)) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value)) result[key] = Math.min(high, Math.max(low, value));
  }
  return result;
}
function loadProfile(dir, channel) {
  const profile = readJson(profilePath(dir, channel));
  if (!profile || profile.channel !== channelKey(channel) || profile.disabled) return { settings: { ...ROOT }, version: "default" };
  return { settings: mergeSettings(ROOT, safeSettings(profile.settings)), version: String(profile.version || "default") };
}
function prefs(dir) {
  const value = readJson(path.join(dir, "monitoring", "preferences.json"), {});
  return { autoTune: value.autoTune !== false };
}
function tailEvents(file, maxBytes = 16 * 1024 * 1024) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    let text = buffer.toString("utf8");
    if (start) text = text.slice(text.indexOf("\n") + 1);
    return text.split("\n").flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  } catch { return []; } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function loadDataset(dir, channel) {
  channel = channelKey(channel);
  const logDir = path.join(dir, "monitoring", "sessions");
  let files = [];
  try { files = fs.readdirSync(logDir).filter(name => name.startsWith(`${channel}-`) && name.endsWith(".jsonl")).sort().slice(-60); } catch {}
  const windows = files.flatMap(name => tailEvents(path.join(logDir, name), 8 * 1024 * 1024)).filter(e => e.kind === "window" && e.channel === channel).slice(-100000);
  const events = tailEvents(path.join(dir, "feedback.jsonl"));
  const completed = new Set(events.filter(e => e.kind === "session-end" && e.mode === "live" && e.channel === channel).map(e => e.sessionId));
  const clips = new Map();
  const ratings = new Map();
  const boundary = { "started-late": 0, "ended-early": 0 };
  for (const event of events) {
    if (event.kind === "clip-created" && event.mode === "live" && event.channel === channel) clips.set(event.clipId, event);
    if (event.kind === "clip-action" && LABELS.has(event.action)) ratings.set(event.clipId, LABELS.get(event.action));
  }
  for (const event of events) if (event.kind === "clip-action" && clips.has(event.clipId) && event.action in boundary) boundary[event.action]++;
  const knownWindows = new Set(windows.map(w => w.id));
  const labels = [];
  for (const [clipId, clip] of clips) {
    const rating = ratings.get(clipId);
    if (rating && completed.has(clip.sessionId) && knownWindows.has(clip.signals?.windowId) && clip.signals?.trigger === "auto") {
      labels.push({ clipId, sessionId: clip.sessionId, windowId: clip.signals.windowId, rating });
    }
  }
  // Missed moments are explicit positive labels, never inferred from chat volume.
  const missed = events.filter(e => e.kind === "missed-moment" && e.channel === channel && completed.has(e.sessionId));
  for (const event of missed) {
    const nearest = windows.filter(w => w.sessionId === event.sessionId && w.eligible).sort((a, b) => Math.abs(a.mediaTime - event.mediaTime) - Math.abs(b.mediaTime - event.mediaTime))[0];
    if (nearest && Math.abs(nearest.mediaTime - event.mediaTime) <= 10 && !labels.some(l => l.windowId === nearest.id)) labels.push({ sessionId: event.sessionId, windowId: nearest.id, rating: 1, missed: true });
  }
  return { windows, labels, completed, boundary, missed: missed.length };
}

// Replay every recorded window; preserve observed outages, exporter busy time,
// chat resets, manual/raid cooldowns and the one-minute warmup. No extra clips.
function replay(windows, settings) {
  const predictions = new Set();
  const states = new Map();
  for (const window of windows) {
    let state = states.get(window.sessionId);
    if (!state) { state = { history: [], lastAuto: -Infinity, observedAuto: null }; states.set(window.sessionId, state); }
    if (window.reset) state.history = [];
    if (window.lastAuto !== state.observedAuto) {
      if (window.lastAuto && window.lastAutoTrigger !== "auto") state.lastAuto = window.lastAuto;
      state.observedAuto = window.lastAuto;
    }
    if (window.eligible) {
      const result = evaluateReaction({ history: state.history, participants: window.participants, reactions: window.reactions, settings });
      if (result.trigger && window.time - state.lastAuto >= settings.autoCooldownMs) {
        predictions.add(window.id);
        state.lastAuto = window.time;
      }
    }
    if (window.joined) {
      state.history.push(window.participants);
      if (state.history.length > settings.historyLimit) state.history.shift();
    }
  }
  return predictions;
}
function score(predictions, labels) {
  const good = labels.filter(l => l.rating > 0);
  const bad = labels.filter(l => l.rating < 0);
  const keptGood = good.filter(l => predictions.has(l.windowId)).length;
  const keptBad = bad.filter(l => predictions.has(l.windowId)).length;
  return { rated: labels.length, good: good.length, bad: bad.length, keptGood, keptBad,
    goodRecall: good.length ? keptGood / good.length : 0,
    utility: labels.length ? (keptGood - keptBad - (good.length - keptGood)) / labels.length : 0 };
}
function candidates(settings) {
  const list = [];
  for (const [key, step] of Object.entries({ sensitivity: 0.10, minReactionShare: 0.025, autoCooldownMs: 30000 })) {
    for (const direction of [-1, 1]) {
      const changed = safeSettings({ [key]: settings[key] + direction * step });
      if (changed[key] !== settings[key]) list.push({ name: `${key} ${direction > 0 ? "+" : "−"}${step}`, settings: mergeSettings(settings, changed) });
    }
  }
  return list;
}
function evaluateDataset(dataset, current = ROOT) {
  const { labels, boundary, missed } = dataset;
  const windows = dataset.completed ? dataset.windows.filter(w => dataset.completed.has(w.sessionId)) : dataset.windows;
  const sessions = [...new Set(windows.map(w => w.sessionId))].filter(id => labels.some(l => l.sessionId === id));
  const split = Math.max(1, sessions.length - 2);
  const training = new Set(sessions.slice(0, split));
  const trainLabels = labels.filter(l => training.has(l.sessionId));
  const holdoutLabels = labels.filter(l => !training.has(l.sessionId));
  const basePredictions = replay(windows, current);
  const baseline = { train: score(basePredictions, trainLabels), holdout: score(basePredictions, holdoutLabels), triggers: basePredictions.size };
  // Choose on training data only. Never use validation to pick a different winner.
  const ranked = (trainLabels.length >= 20 ? candidates(current) : []).map(candidate => {
    const predictions = replay(windows, candidate.settings);
    return { ...candidate, train: score(predictions, trainLabels), predictions };
  }).sort((a, b) => b.train.utility - a.train.utility);
  const winner = ranked[0];
  const reasons = [];
  if (sessions.length < 6) reasons.push(`Need 6 rated completed live sessions (${sessions.length}/6).`);
  if (labels.length < 30) reasons.push(`Need 30 explicit ratings (${labels.length}/30).`);
  if (trainLabels.length < 20 || holdoutLabels.length < 10) reasons.push("Need 20 training ratings and 10 ratings from the two latest sessions.");
  if (baseline.train.good < 2 || baseline.train.bad < 2 || baseline.holdout.good < 2 || baseline.holdout.bad < 2) reasons.push("Both training and validation need at least two good and two bad clips.");
  let candidate = null;
  if (winner) {
    const holdout = score(winner.predictions, holdoutLabels);
    candidate = { name: winner.name, settings: safeSettings(winner.settings), train: winner.train, holdout, triggers: winner.predictions.size };
    if (winner.train.utility - baseline.train.utility < 0.08) reasons.push("No sufficient improvement on training sessions.");
    if (holdout.utility - baseline.holdout.utility < 0.08) reasons.push("Improvement did not hold up on later sessions.");
    if (winner.train.goodRecall < 0.9 || holdout.goodRecall < 0.9) reasons.push("Candidate must retain at least 90% of explicitly good moments.");
    if (candidate.triggers > baseline.triggers * 1.1 + 1) reasons.push("Candidate would create too many additional unreviewed triggers.");
  } else if (!reasons.length) reasons.push("No bounded candidate is available.");
  const fingerprint = createHash("sha256").update(JSON.stringify({ labels, current })).digest("hex").slice(0, 20);
  return { version: 1, at: new Date().toISOString(), fingerprint, ratedSessions: sessions.length, ratedClips: labels.length,
    windows: windows.length, baseline, candidate, eligible: reasons.length === 0, reasons, boundary, missed,
    validationSessions: sessions.slice(split),
    limitation: "Replay uses observed recorder availability. Unrated windows have unknown quality; this is exploratory tuning, not proof of better social performance." };
}
function evaluateChannel(dir, channel) {
  const profile = loadProfile(dir, channel);
  return { channel: channelKey(channel), profileVersion: profile.version, ...evaluateDataset(loadDataset(dir, channel), profile.settings) };
}
function stageProfile(dir, channel, report) {
  if (!report.eligible || !report.candidate) return false;
  const file = profilePath(dir, channel);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  let lock;
  try { lock = fs.openSync(`${file}.lock`, "wx", 0o600); } catch { return false; }
  try {
    if (!prefs(dir).autoTune) return false;
    const old = readJson(file);
    if (loadProfile(dir, channel).version !== report.profileVersion) return false;
    if (old?.fingerprint === report.fingerprint) return false;
    // Don't reuse validation sessions to justify successive promotions.
    if (old?.validationSessions?.some(id => report.validationSessions.includes(id))) return false;
    const next = { version: randomUUID(), channel: channelKey(channel), at: new Date().toISOString(),
      settings: safeSettings(report.candidate.settings), fingerprint: report.fingerprint,
      validationSessions: report.validationSessions, previous: old ? { ...old, previous: undefined } : null };
    writeJson(file, next);
    return next;
  } finally { fs.closeSync(lock); fs.unlinkSync(`${file}.lock`); }
}
function rollback(dir, channel) {
  const file = profilePath(dir, channel);
  const old = readJson(file);
  writeJson(file, old?.previous ? { ...old.previous, disabled: false } : { channel: channelKey(channel), disabled: true, version: "default" });
  // Pause automatic tuning after rollback so the same evidence cannot reapply it.
  writeJson(path.join(dir, "monitoring", "preferences.json"), { autoTune: false });
}

module.exports = { ROOT, LIMITS, LABELS, channelKey, readJson, writeJson, safeSettings, profilePath, loadProfile, prefs,
  tailEvents, loadDataset, replay, score, candidates, evaluateDataset, evaluateChannel, stageProfile, rollback };
