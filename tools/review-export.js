#!/usr/bin/env node
"use strict";

// Prints a compact summary of the local feedback log since the last review:
// each clip's chat signals next to what happened to it afterwards.
//
//   node tools/review-export.js                 # text summary
//   node tools/review-export.js --json          # same data as JSON
//   node tools/review-export.js --all           # ignore the last review date
//   node tools/review-export.js --mark-reviewed # reset the session counter

const feedback = require("../lib/feedback.js");

function summarize(events, { since = null } = {}) {
  const after = since ? Date.parse(since) : -Infinity;
  const recent = events.filter((event) => Date.parse(event.at) > after);
  const sessions = new Map();
  const clips = new Map();
  for (const event of recent) {
    if (event.kind === "session-start" || event.kind === "session-end") {
      const session = sessions.get(event.sessionId) || { sessionId: event.sessionId, mode: event.mode, channel: event.channel, vodId: event.vodId || null };
      if (event.kind === "session-start") session.startedAt = event.at;
      else Object.assign(session, { endedAt: event.at, durationSec: event.durationSec, clips: event.clips, cancelled: Boolean(event.cancelled) });
      sessions.set(event.sessionId, session);
    } else if (event.kind === "clip-created") {
      clips.set(event.clipId, {
        clipId: event.clipId, at: event.at, mode: event.mode, channel: event.channel, sessionId: event.sessionId,
        vodOffsetSec: event.vodOffsetSec ?? null, signals: event.signals || {}, hook: event.hook || null, captions: event.captions || null,
        outcome: { opened: 0, revealed: 0, uploaded: false, deleted: false, missing: false, rating: 0 }
      });
    }
  }
  // Actions can arrive for clips created before the review window; keep those too.
  for (const event of events) {
    if (event.kind !== "clip-action") continue;
    const clip = clips.get(event.clipId);
    if (!clip) continue;
    const outcome = clip.outcome;
    if (event.action === "opened") outcome.opened += 1;
    else if (event.action === "revealed") outcome.revealed += 1;
    else if (event.action === "uploaded") outcome.uploaded = true;
    else if (event.action === "deleted") outcome.deleted = true;
    else if (event.action === "missing") outcome.missing = true;
    else if (event.action === "rated-up") outcome.rating = 1;
    else if (event.action === "rated-down") outcome.rating = -1;
    else if (event.action === "duplicate") outcome.rating = -1;
    else if (event.action === "rating-cleared") outcome.rating = 0;
  }
  const clipList = [...clips.values()].sort((a, b) => a.at.localeCompare(b.at));
  const totals = {
    sessions: sessions.size,
    clips: clipList.length,
    ratedUp: clipList.filter((c) => c.outcome.rating > 0).length,
    ratedDown: clipList.filter((c) => c.outcome.rating < 0).length,
    opened: clipList.filter((c) => c.outcome.opened > 0).length,
    uploaded: clipList.filter((c) => c.outcome.uploaded).length,
    deleted: clipList.filter((c) => c.outcome.deleted || c.outcome.missing).length
  };
  return { since, totals, sessions: [...sessions.values()], clips: clipList };
}

const fmt = (value, digits = 2) => (value == null || Number.isNaN(value) ? "-" : (typeof value === "number" ? String(Math.round(value * 10 ** digits) / 10 ** digits) : String(value)));

function outcomeLabel(outcome) {
  const parts = [];
  if (outcome.rating > 0) parts.push("👍");
  if (outcome.rating < 0) parts.push("👎");
  if (outcome.opened) parts.push(`opened×${outcome.opened}`);
  if (outcome.revealed) parts.push("revealed");
  if (outcome.uploaded) parts.push("uploaded");
  if (outcome.deleted) parts.push("deleted");
  else if (outcome.missing) parts.push("missing");
  return parts.join(" ") || "untouched";
}

function formatText(summary) {
  const lines = [];
  const t = summary.totals;
  lines.push(`Feedback since ${summary.since || "the beginning"}: ${t.sessions} session${t.sessions === 1 ? "" : "s"}, ${t.clips} clip${t.clips === 1 ? "" : "s"}`);
  lines.push(`  👍 ${t.ratedUp} · 👎 ${t.ratedDown} · opened ${t.opened} · uploaded ${t.uploaded} · deleted ${t.deleted}`);
  for (const session of summary.sessions) {
    lines.push(`Session ${session.mode} ${session.channel || "?"}${session.vodId ? ` vod ${session.vodId}` : ""}: ${session.startedAt || "?"} · ${fmt(session.durationSec, 0)}s · ${session.clips ?? "?"} clips${session.cancelled ? " (cancelled)" : ""}`);
  }
  if (summary.clips.length) lines.push("clip | mode | chatters jump share msgs | emotes(div) | top message ×n | caps len clipIt | score rank strong | hook cap | outcome");
  for (const clip of summary.clips) {
    const s = clip.signals || {};
    const emotes = (s.topEmotes || []).slice(0, 2).map((e) => `${e.name}×${e.count}`).join(",");
    lines.push([
      clip.clipId.slice(0, 8),
      `${clip.mode} ${clip.channel || ""}`.trim(),
      `${fmt(s.chatters, 0)} ${fmt(s.chatterJump)} ${fmt(s.reactionShare)} ${fmt(s.messages, 0)}`,
      `${emotes || "-"}(${fmt(s.emoteDiversity, 0)})`,
      s.topMessage ? `"${s.topMessage}"×${s.topMessageCount}` : "-",
      `${fmt(s.capsRatio)} ${fmt(s.avgMessageLength, 1)} ${fmt(s.clipMentions, 0)}`,
      `${fmt(s.score)} ${fmt(s.rank)} ${s.strong == null ? "-" : s.strong ? "★" : "·"}`,
      `${clip.hook && clip.hook.on ? "H" : "-"}${clip.captions && clip.captions.on ? "C" : "-"}`,
      outcomeLabel(clip.outcome)
    ].join(" | "));
  }
  return lines.join("\n");
}

function main(argv = process.argv.slice(2)) {
  const dir = feedback.feedbackDir();
  const state = feedback.readReviewState(dir);
  if (argv.includes("--mark-reviewed")) {
    const next = feedback.markReviewed({ dir });
    console.log(`Marked reviewed at ${next.lastReviewAt}. Session counter reset (was ${state.sinceReview}).`);
    return 0;
  }
  const summary = summarize(feedback.readEvents(dir), { since: argv.includes("--all") ? null : state.lastReviewAt });
  summary.sessionsSinceReview = state.sinceReview;
  console.log(argv.includes("--json") ? JSON.stringify(summary, null, 2) : formatText(summary));
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = { summarize, formatText, outcomeLabel, main };
