"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const feedback = require("../lib/feedback.js");
const { summarize, formatText } = require("../tools/review-export.js");
const { chatSignals } = require("../lib/vodscan.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hd-feedback-"));
}

// A clock that moves forward by `step` ms on every call.
function clock(startIso, step = 120000) {
  let t = Date.parse(startIso);
  return () => { const d = new Date(t); t += step; return d; };
}

test("sessions, clips and actions are appended as JSON lines", () => {
  const dir = tempDir();
  try {
    const session = feedback.startSession({ mode: "vod", channel: "xqc", vodId: "123" }, { dir, now: clock("2026-11-16T10:00:00Z") });
    session.countClip();
    feedback.logClipCreated({ clipId: "c1", sessionId: session.sessionId, mode: "vod", channel: "xqc", signals: { chatters: 50, score: 2.4 }, hook: { text: "LOL", source: "chat" } }, { dir });
    feedback.logClipAction({ clipId: "c1", action: "rated-up" }, { dir });
    assert.equal(feedback.logClipAction({ clipId: "c1", action: "exploded" }, { dir }), false);
    session.end();
    session.end(); // idempotent
    const events = feedback.readEvents(dir);
    assert.deepEqual(events.map((e) => e.kind), ["session-start", "clip-created", "clip-action", "session-end"]);
    assert.equal(events[1].hook.on, true);
    assert.equal(events[1].captions.on, false);
    assert.equal(events[3].clips, 1);
    assert.equal(events[3].durationSec, 120);
    assert.ok(fs.readFileSync(path.join(dir, "feedback.jsonl"), "utf8").endsWith("\n"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the review becomes ready after three finished sessions, once", () => {
  const dir = tempDir();
  try {
    const now = clock("2026-11-16T10:00:00Z");
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(feedback.startSession({ mode: "live", channel: "a" }, { dir, now }).end());
    assert.deepEqual(results.map((r) => r.count), [1, 2, 3, 4]);
    assert.equal(results[0].ready, null);
    assert.equal(results[1].ready, null);
    assert.equal(results[2].ready.sessions, 3);
    assert.match(results[2].ready.message, /3 sessions logged\. Open Capture Monitor to review your highlights\./);
    assert.equal(results[3].ready, null, "only announced once");
    const ready = JSON.parse(fs.readFileSync(path.join(dir, "review-ready.json"), "utf8"));
    assert.equal(ready.from, "2026-11-16T10:00:00.000Z");
    assert.equal(ready.sessionIds.length, 3);

    const reset = feedback.markReviewed({ dir, now: new Date("2026-11-16T12:00:00Z") });
    assert.equal(reset.sinceReview, 0);
    assert.equal(fs.existsSync(path.join(dir, "review-ready.json")), false);
    assert.equal(feedback.readReviewState(dir).lastReviewAt, "2026-11-16T12:00:00.000Z");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("sessions that never got going do not count toward a review", () => {
  const dir = tempDir();
  try {
    const result = feedback.startSession({ mode: "vod" }, { dir, now: clock("2026-11-16T10:00:00Z", 5000) }).end();
    assert.equal(result.count, 0);
    assert.equal(feedback.readEvents(dir).filter((e) => e.kind === "session-end").length, 1, "still logged");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a broken log line is skipped and logging never throws", () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, "feedback.jsonl"), "{not json\n" + JSON.stringify({ kind: "clip-action", clipId: "x", action: "opened", at: "2026-11-16T10:00:00Z" }) + "\n");
    assert.equal(feedback.readEvents(dir).length, 1);
    const blocker = path.join(dir, "not-a-directory");
    fs.writeFileSync(blocker, "x");
    assert.equal(feedback.logEvent("x", {}, { dir: path.join(blocker, "nope") }), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("review export pairs each clip's signals with what happened to it", () => {
  const events = [
    { kind: "session-start", at: "2026-11-15T09:00:00Z", sessionId: "old", mode: "live", channel: "a" },
    { kind: "clip-created", at: "2026-11-15T09:10:00Z", clipId: "old-clip", mode: "live", signals: {} },
    { kind: "session-start", at: "2026-11-16T10:00:00Z", sessionId: "s1", mode: "vod", channel: "xqc", vodId: "9" },
    { kind: "clip-created", at: "2026-11-16T10:05:00Z", clipId: "clip-aaaa1111", sessionId: "s1", mode: "vod", channel: "xqc",
      signals: { chatters: 54, chatterJump: 2.1, reactionShare: 0.6, messages: 70, topEmotes: [{ name: "OOOO", count: 26 }], emoteDiversity: 4, topMessage: "no way", topMessageCount: 5, capsRatio: 0.4, avgMessageLength: 9.5, clipMentions: 2, score: 2.35, rank: 2.6, strong: false },
      hook: { on: true }, captions: { on: true } },
    { kind: "clip-created", at: "2026-11-16T10:06:00Z", clipId: "clip-bbbb2222", sessionId: "s1", mode: "vod", channel: "xqc", signals: {} },
    { kind: "clip-action", at: "2026-11-16T10:10:00Z", clipId: "clip-aaaa1111", action: "opened" },
    { kind: "clip-action", at: "2026-11-16T10:11:00Z", clipId: "clip-aaaa1111", action: "opened" },
    { kind: "clip-action", at: "2026-11-16T10:12:00Z", clipId: "clip-aaaa1111", action: "rated-up" },
    { kind: "clip-action", at: "2026-11-16T10:13:00Z", clipId: "clip-bbbb2222", action: "rated-down" },
    { kind: "clip-action", at: "2026-11-16T10:14:00Z", clipId: "clip-bbbb2222", action: "deleted" },
    { kind: "session-end", at: "2026-11-16T10:20:00Z", sessionId: "s1", mode: "vod", channel: "xqc", durationSec: 1200, clips: 2 }
  ];
  const summary = summarize(events, { since: "2026-11-16T00:00:00Z" });
  assert.equal(summary.totals.sessions, 1);
  assert.equal(summary.totals.clips, 2);
  assert.deepEqual(summary.clips.map((c) => c.clipId), ["clip-aaaa1111", "clip-bbbb2222"]);
  assert.deepEqual(summary.clips[0].outcome, { opened: 2, revealed: 0, uploaded: false, deleted: false, missing: false, rating: 1 });
  assert.equal(summary.totals.ratedDown, 1);
  assert.equal(summary.totals.deleted, 1);
  const text = formatText(summary);
  assert.match(text, /1 session, 2 clips/);
  assert.match(text, /clip-aaa \| vod xqc \| 54 2\.1 0\.6 70 \| OOOO×26\(4\) \| "no way"×5 \| 0\.4 9\.5 2 \| 2\.35 2\.6 · \| HC \| 👍 opened×2/);
  assert.match(text, /👎 deleted/);
});

test("review-export --mark-reviewed resets the counter", () => {
  const dir = tempDir();
  const previous = process.env.CLIPSPIKE_STATE;
  process.env.CLIPSPIKE_STATE = dir;
  const log = console.log;
  const printed = [];
  console.log = (line) => printed.push(line);
  try {
    const now = clock("2026-11-16T10:00:00Z");
    for (let i = 0; i < 3; i += 1) feedback.startSession({ mode: "live" }, { dir, now }).end();
    const { main } = require("../tools/review-export.js");
    main([]);
    assert.match(printed[0], /3 sessions, 0 clips/);
    main(["--mark-reviewed"]);
    assert.match(printed[1], /Session counter reset \(was 3\)/);
    assert.equal(feedback.readReviewState(dir).sinceReview, 0);
  } finally {
    console.log = log;
    if (previous === undefined) delete process.env.CLIPSPIKE_STATE; else process.env.CLIPSPIKE_STATE = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("chatSignals measures repeats, caps, length and clip-it mentions", () => {
  const c = (user, text) => ({ user, text });
  const signals = chatSignals([c("a", "CLIP IT"), c("b", "clip that"), c("c", "no way ͏"), c("d", "No way"), c("d", "no way"), c("e", "lol")]);
  assert.equal(signals.clipMentions, 2);
  assert.equal(signals.topMessage, "no way");
  assert.equal(signals.topMessageCount, 2);
  assert.ok(signals.capsRatio > 0.2 && signals.capsRatio < 0.5);
  assert.ok(signals.avgMessageLength > 3 && signals.avgMessageLength < 10);
});
