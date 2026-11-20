"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parentPort, workerData } = require("node:worker_threads");
const policy = require("./monitor-policy.js");

const { dir, channel, sessionId, settings } = workerData;
const root = path.join(dir, "monitoring");
const logs = path.join(root, "sessions");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const prefix = `${channel}-${stamp}-${sessionId}`;
let part = 0;
let bytes = 0;
let log;
let disabled = false;
let lastSnapshot = 0;
let lastEvaluation = 0;
const state = { version: 1, channel, sessionId, startedAt: new Date().toISOString(), settings,
  windows: 0, accepted: 0, suppressed: 0, exported: 0, uploaded: 0, failures: 0, dropped: 0, lastWindow: null, health: "Starting" };
let requestedAt = null;

function send(value) { parentPort.postMessage(value); }
function protect(fn) {
  try { return fn(); } catch (error) {
    disabled = true;
    send({ type: "monitor-error", message: `Monitoring paused: ${error.message}` });
  }
}
function openLog() {
  fs.mkdirSync(logs, { recursive: true, mode: 0o700 });
  log = path.join(logs, `${prefix}-${String(part).padStart(3, "0")}.jsonl`);
  bytes = 0;
}
function append(record) {
  const line = JSON.stringify(record) + "\n";
  if (bytes > 4 * 1024 * 1024) { part++; openLog(); }
  fs.appendFileSync(log, line, { mode: 0o600 });
  bytes += Buffer.byteLength(line);
}
function snapshot(force = false) {
  const now = Date.now();
  if (!force && now - lastSnapshot < 5000) return;
  lastSnapshot = now;
  const window = state.lastWindow;
  if (window) {
    state.health = now - window.time > 15000 ? "Chat sampler stalled" : !window.recording ? "Recorder reconnecting" : window.frameAgeMs > 15000 ? "Video stalled" : !window.joined ? "Chat disconnected" : "Capturing";
  }
  state.at = new Date().toISOString();
  policy.writeJson(path.join(root, "live", `${sessionId}.json`), state);
  send({ type: "monitor-status", ...state });
}
function evaluate(force = false) {
  const now = Date.now();
  if (!force && now - lastEvaluation < 60000) return;
  lastEvaluation = now;
  const report = policy.evaluateChannel(dir, channel);
  const staged = policy.prefs(dir).autoTune && policy.stageProfile(dir, channel, report);
  report.autoTune = policy.prefs(dir).autoTune;
  report.staged = Boolean(staged);
  report.nextCapture = policy.loadProfile(dir, channel);
  policy.writeJson(path.join(root, "reports", `${channel}.json`), report);
  send({ type: "monitor-report", report });
}
// Retention only touches this monitor's logs. Clips and feedback are untouched.
function cleanup() {
  const now = Date.now();
  const entries = fs.readdirSync(logs).filter(name => /^[a-z0-9_-]+-.*\.jsonl$/.test(name))
    .map(name => ({ name, stat: fs.statSync(path.join(logs, name)) })).sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  entries.forEach((entry, index) => {
    if (!entry.name.startsWith(prefix) && (index >= 120 || now - entry.stat.mtimeMs > 30 * 86400000)) fs.unlinkSync(path.join(logs, entry.name));
  });
  const liveDir = path.join(root, "live");
  if (fs.existsSync(liveDir)) for (const name of fs.readdirSync(liveDir)) {
    if (name.endsWith(".json") && now - fs.statSync(path.join(liveDir, name)).mtimeMs > 7 * 86400000) fs.unlinkSync(path.join(liveDir, name));
  }
}
protect(() => { openLog(); cleanup(); append({ kind: "monitor-start", at: state.startedAt, channel, sessionId, settings }); snapshot(true); evaluate(true); });
const timer = setInterval(() => { if (!disabled) protect(() => { snapshot(); evaluate(); }); }, 10000);
parentPort.on("message", message => {
  if (message.type === "close") {
    state.dropped = message.dropped || 0;
    clearInterval(timer);
    if (!disabled) protect(() => { state.endedAt = new Date().toISOString(); append({ kind: "monitor-end", at: state.endedAt, channel, sessionId }); snapshot(true); evaluate(true); });
    parentPort.close();
    return;
  }
  if (message.type !== "record") return;
  if (!disabled) protect(() => {
    const record = message.record;
    state.dropped = message.dropped;
    append({ ...record, channel, sessionId });
    if (record.kind === "window") {
      state.windows++;
      state.lastWindow = record;
      if (record.accepted) state.accepted++;
      if (record.result?.trigger && !record.accepted) state.suppressed++;
    } else if (record.kind === "pipeline") {
      if (record.event === "clip-requested") requestedAt = Date.parse(record.at);
      if (record.event === "clip-exported") {
        state.exported++;
        if (requestedAt !== null) state.lastExportMs = Math.max(0, Date.parse(record.at) - requestedAt);
      }
      if (record.event === "clip-uploaded") state.uploaded++;
      if (["clip-failed", "error", "fatal"].includes(record.event)) state.failures++;
    }
    snapshot();
  });
  send({ type: "ack" });
});
