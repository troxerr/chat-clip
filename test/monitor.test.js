"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const policy = require("../lib/monitor-policy.js");
const feedback = require("../lib/feedback.js");
const { startMonitor } = require("../lib/monitor.js");

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hd-monitor-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function dataset({ reverseHoldout = false, sessions = 6 } = {}) {
  const windows = [], labels = [];
  let time = 1000000;
  for (let session = 0; session < sessions; session++) {
    const sessionId = `s${session}`;
    for (let clip = 0; clip < 5; clip++) {
      for (let i = 0; i < 75; i++) {
        windows.push({ id: `${sessionId}-${clip}-warm-${i}`, sessionId, time: time += 5000,
          mediaTime: i * 5, participants: 10, reactions: 1, eligible: true, joined: true,
          reset: clip === 0 && i === 0, lastAuto: 0 });
      }
      const good = clip < 3;
      const id = `${sessionId}-${clip}`;
      windows.push({ id, sessionId, time: time += 5000, mediaTime: 500,
        participants: good ? 40 : 25, reactions: good ? 30 : 9, eligible: true, joined: true, lastAuto: 0 });
      labels.push({ clipId: id, sessionId, windowId: id, rating: (reverseHoldout && session >= 4 ? !good : good) ? 1 : -1 });
    }
  }
  return { windows, labels, boundary: { "started-late": 0, "ended-early": 0 }, missed: 0 };
}

test("training selects a bounded candidate, which must also improve later sessions", () => {
  const report = policy.evaluateDataset(dataset());
  assert.equal(report.ratedClips, 30);
  assert.equal(report.eligible, true, report.reasons.join(" "));
  assert.equal(report.candidate.settings.minReactionShare, 0.375);
  assert.equal(report.candidate.holdout.goodRecall, 1);
  assert.ok(report.candidate.holdout.utility > report.baseline.holdout.utility);
  assert.deepEqual(report.validationSessions, ["s4", "s5"]);
  const rejected = policy.evaluateDataset(dataset({ reverseHoldout: true }));
  assert.equal(rejected.eligible, false);
  assert.ok(rejected.reasons.some(reason => reason.includes("later sessions")));
});

test("small, all-positive or unlabeled datasets cannot tune automatically", () => {
  const small = policy.evaluateDataset(dataset({ sessions: 3 }));
  assert.equal(small.eligible, false);
  const positive = dataset(); positive.labels.forEach(label => label.rating = 1);
  assert.equal(policy.evaluateDataset(positive).eligible, false);
  const empty = dataset(); empty.labels = [];
  assert.equal(policy.evaluateDataset(empty).eligible, false);
  const active = dataset(); active.completed = new Set();
  const result = policy.evaluateDataset({ ...active, labels: [] });
  assert.equal(result.windows, 0, "active session windows do not enter evaluation");
  assert.equal(result.candidate, null);
});

test("replay respects warmup, busy windows, cooldown, raids and reconnect resets", () => {
  const data = dataset({ sessions: 1 });
  const predictions = policy.replay(data.windows, policy.ROOT);
  assert.equal(predictions.size, 5);
  const spike = data.windows.find(w => w.id === "s0-0");
  spike.eligible = false;
  assert.equal(policy.replay(data.windows, policy.ROOT).has(spike.id), false);
  spike.eligible = true;
  spike.reset = true;
  assert.equal(policy.replay(data.windows, policy.ROOT).has(spike.id), false);
  spike.reset = false;
  spike.lastAuto = spike.time - 5000; spike.lastAutoTrigger = "raid";
  assert.equal(policy.replay(data.windows, policy.ROOT).has(spike.id), false);
});

test("profiles ignore executable/unbounded settings and only change the next loaded session", t => {
  const dir = temporary(t);
  assert.throws(() => policy.loadProfile(dir, "../../evil"), /valid Twitch/);
  const running = policy.loadProfile(dir, "example");
  const report = { ...policy.evaluateDataset(dataset()), profileVersion: "default" };
  const saved = policy.stageProfile(dir, "example", report);
  assert.ok(saved);
  assert.equal(running.settings.minReactionShare, 0.35);
  assert.equal(policy.loadProfile(dir, "example").settings.minReactionShare, 0.375);
  assert.equal(policy.stageProfile(dir, "example", report), false, "stale report cannot overwrite a newer profile");
  const nextReport = { ...report, fingerprint: "new", profileVersion: saved.version };
  assert.equal(policy.stageProfile(dir, "example", nextReport), false, "validation sessions cannot be reused");
  policy.rollback(dir, "example");
  assert.equal(policy.loadProfile(dir, "example").version, "default");
  assert.equal(policy.prefs(dir).autoTune, false);
  assert.equal(policy.stageProfile(dir, "example", report), false);
  policy.writeJson(policy.profilePath(dir, "example"), { channel: "example", version: "bad", settings: { sensitivity: 999, minReactionShare: 0, autoCooldownMs: 0, preRollSec: 900, command: "anything" } });
  const bounded = policy.loadProfile(dir, "example").settings;
  assert.equal(bounded.sensitivity, 1.25);
  assert.equal(bounded.minReactionShare, 0.30);
  assert.equal(bounded.autoCooldownMs, 270000);
  assert.equal(bounded.preRollSec, policy.ROOT.preRollSec);
});

test("dataset isolates channels, uses final explicit ratings and includes missed moments", t => {
  const dir = temporary(t);
  const file = path.join(dir, "monitoring", "sessions", "example-2026-session-000.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    { kind: "window", channel: "example", id: "w", sessionId: "s", eligible: true, mediaTime: 100 },
    { kind: "window", channel: "example", id: "miss", sessionId: "s", eligible: true, mediaTime: 150 }
  ].map(e => JSON.stringify(e)).join("\n") + "\n{partial");
  const log = (kind, data) => feedback.logEvent(kind, data, { dir });
  log("session-end", { sessionId: "s", mode: "live", channel: "example" });
  log("clip-created", { clipId: "c", sessionId: "s", mode: "live", channel: "example", signals: { windowId: "w", trigger: "auto" } });
  for (const action of ["rated-up", "opened", "uploaded", "rated-down", "rating-cleared"]) log("clip-action", { clipId: "c", action });
  assert.equal(policy.loadDataset(dir, "example").labels.length, 0);
  log("clip-action", { clipId: "c", action: "duplicate" });
  log("missed-moment", { sessionId: "s", channel: "example", mediaTime: 150 });
  log("clip-action", { clipId: "c", action: "started-late" });
  const data = policy.loadDataset(dir, "example");
  assert.deepEqual(data.labels.map(l => l.rating), [-1, 1]);
  assert.equal(data.boundary["started-late"], 1);
  assert.equal(policy.loadDataset(dir, "other").labels.length, 0);
});

test("worker persists windows, health and reports and drains safely on close", async t => {
  const dir = temporary(t);
  const messages = [];
  const monitor = startMonitor({ dir, channel: "example", sessionId: "test-session", settings: policy.ROOT, onStatus: event => messages.push(event) });
  const now = Date.now();
  for (let i = 0; i < 20; i++) monitor.record({ kind: "window", id: `w${i}`, time: now + i, at: new Date(now).toISOString(),
    mediaTime: i * 5, participants: 10, reactions: 1, messages: 10, joined: true, recording: true, frameAgeMs: 0,
    eligible: true, reset: i === 0, result: { trigger: false } });
  await monitor.close();
  const snapshot = policy.readJson(path.join(dir, "monitoring", "live", "test-session.json"));
  assert.equal(snapshot.windows, 20);
  assert.ok(snapshot.endedAt);
  assert.ok(messages.some(m => m.type === "monitor-report"));
  assert.equal(policy.loadDataset(dir, "example").windows.length, 20);
  assert.equal(monitor.record({}), false);
  await monitor.close();
});

test("unwritable monitoring state does not crash the capture client", async () => {
  const messages = [];
  const blocker = require("node:path").join(require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "hd-mon-")), "not-a-directory");
  require("node:fs").writeFileSync(blocker, "x");
  const monitor = startMonitor({ dir: require("node:path").join(blocker, "nope"), channel: "example", sessionId: "s", settings: policy.ROOT, onStatus: event => messages.push(event) });
  monitor.record({ kind: "window", time: Date.now() });
  await monitor.close();
  assert.ok(messages.some(m => m.type === "monitor-error"));
});
