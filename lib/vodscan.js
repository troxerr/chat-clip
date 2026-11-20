"use strict";

// Finds the moments chat reacted to in a downloaded VOD chat log.
//
// Each 5-second window is scored with the same detector the live recorder uses
// (unique chatters against a rolling median, plus how many of them reacted).
// Live capture needs a hard yes/no, but a VOD is already over, so instead of
// only keeping windows that clear the live threshold we rank every peak and
// keep the strongest N, at least minGapSec apart (5 minutes by default, so one
// long reaction doesn't turn into several near-identical clips). Windows that would have
// triggered live are marked `strong`. This matters on big channels, where chat
// is loud all the time and a real moment is a smaller jump over the baseline.

const { evaluateReaction, isReaction, collectEmotes, topEmotes } = require("../dist/reactions.js");
const { settingsFor, mergeSettings } = require("../dist/config.js");

const round = (value) => Math.round((Number(value) || 0) * 100) / 100;

const INVISIBLE = /[\p{Cf}\u034F\u2800\u{E0000}-\u{E007F}]/gu;
const CLIP_MENTION = /\bclip\s*(it|that|this)\b/i;

// Text-level chat signals for one window, logged with each clip so picking can
// later be tuned against what actually got used.
function chatSignals(comments) {
  const groups = new Map();
  let letters = 0;
  let upper = 0;
  let totalLength = 0;
  let clipMentions = 0;
  for (const comment of comments) {
    const text = String(comment.text || "").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
    totalLength += text.length;
    for (const char of text) {
      if (/\p{L}/u.test(char)) {
        letters += 1;
        if (char !== char.toLowerCase() && char === char.toUpperCase()) upper += 1;
      }
    }
    if (CLIP_MENTION.test(text)) clipMentions += 1;
    const key = text.toLowerCase();
    if (!key) continue;
    const group = groups.get(key) || { text, users: new Set() };
    group.users.add(comment.user || comment.id);
    groups.set(key, group);
  }
  let top = null;
  for (const group of groups.values()) if (!top || group.users.size > top.users.size) top = group;
  return {
    topMessage: top ? top.text.slice(0, 60) : null,
    topMessageCount: top ? top.users.size : 0,
    capsRatio: round(letters ? upper / letters : 0),
    avgMessageLength: round(comments.length ? totalLength / comments.length : 0),
    clipMentions
  };
}

function buildEmoteSet(comments, extra = []) {
  const set = new Set(extra);
  for (const comment of comments) {
    for (const name of comment.emotes || []) set.add(name);
  }
  return set;
}

function scanChat(comments, {
  emotes,
  settings: overrides = {},
  start = 0,
  end,
  reportFrom,
  limit = 15,
  minGapSec = 300
} = {}) {
  const settings = mergeSettings(settingsFor("desktop"), overrides);
  const windowSec = settings.sampleMs / 1000;
  const gapSec = Number.isFinite(Number(minGapSec)) && Number(minGapSec) > 0 ? Number(minGapSec) : settings.autoCooldownMs / 1000;
  const sorted = [...comments].sort((a, b) => a.offset - b.offset);
  const emoteSet = emotes instanceof Set ? emotes : buildEmoteSet(sorted, emotes || []);
  const from = Math.max(0, Number(start) || 0);
  // Chat before reportFrom only warms up the baseline; moments are reported from here on.
  const reportStart = Number.isFinite(reportFrom) ? Math.max(from, reportFrom) : from;
  const lastOffset = sorted.length ? sorted[sorted.length - 1].offset : from;
  const to = Number.isFinite(end) ? end : lastOffset + windowSec;

  const history = [];
  const candidates = [];
  const activity = [];
  let index = 0;
  while (index < sorted.length && sorted[index].offset < from) index += 1;

  for (let windowStart = from; windowStart < to; windowStart += windowSec) {
    const windowEnd = windowStart + windowSec;
    const viewers = new Set();
    const reactors = new Set();
    const emoteCounts = new Map();
    let messages = 0;
    const windowComments = [];
    while (index < sorted.length && sorted[index].offset < windowEnd) {
      const comment = sorted[index];
      index += 1;
      messages += 1;
      windowComments.push(comment);
      const user = comment.user || comment.id;
      viewers.add(user);
      if (isReaction(comment.text, emoteSet)) reactors.add(user);
      collectEmotes(comment.text, emoteSet, emoteCounts);
    }

    const result = evaluateReaction({
      history,
      participants: viewers.size,
      reactions: reactors.size,
      settings
    });
    const warm = history.length >= settings.warmupWindows;
    history.push(viewers.size);
    if (history.length > settings.historyLimit) history.shift();
    if (windowStart < reportStart) continue;

    activity.push({ at: round(windowStart), participants: viewers.size, messages });
    if (!warm || viewers.size < settings.minParticipants || reactors.size < settings.minReactions) continue;
    const share = reactors.size / Math.max(1, viewers.size);
    // A jump in chatters counts most; a chat that is mostly reacting counts extra.
    const rank = result.score * (0.5 + share);
    if (result.score < 1.1 && !result.trigger) continue;
    candidates.push({ windowEnd, result, viewers: viewers.size, reactors: reactors.size, messages, emoteCounts, share, rank, windowComments });
  }

  const strongCount = candidates.filter((c) => c.result.trigger).length;
  // Strongest first; skip anything within gapSec of a moment already kept.
  // Rank decides; a window that would have triggered live gets only a small bonus, so one loud hour can't crowd out the rest.
  const weight = (c) => c.rank * (c.result.trigger ? 1.1 : 1);
  candidates.sort((a, b) => weight(b) - weight(a) || a.windowEnd - b.windowEnd);
  const kept = [];
  for (const candidate of candidates) {
    if (limit > 0 && kept.length >= limit) break;
    if (kept.some((other) => Math.abs(other.windowEnd - candidate.windowEnd) < gapSec)) continue;
    kept.push(candidate);
  }

  const moments = kept.sort((a, b) => a.windowEnd - b.windowEnd).map((c) => {
    const top = topEmotes(c.emoteCounts);
    return {
      at: round(c.windowEnd),
      trigger: "auto",
      strong: c.result.trigger,
      reason: `Chat spike · ${c.viewers} chatters${top.length ? ` · ${top[0].name} ×${top[0].count}` : ""}`,
      score: c.result.score,
      rank: round(c.rank),
      threshold: c.result.threshold,
      participants: c.viewers,
      reactions: c.reactors,
      reactionShare: round(c.share),
      messages: c.messages,
      topEmotes: top,
      signals: {
        chatters: c.viewers,
        baseline: c.result.median,
        chatterJump: round(c.viewers / Math.max(1, c.result.median || 0)),
        reactionShare: round(c.share),
        messages: c.messages,
        topEmotes: top,
        emoteDiversity: c.emoteCounts.size,
        ...chatSignals(c.windowComments),
        score: c.result.score,
        threshold: c.result.threshold,
        rank: round(c.rank),
        strong: c.result.trigger
      }
    };
  });
  return { moments, total: moments.length, strong: strongCount, activity, windowSec, gapSec, settings };
}

module.exports = { scanChat, buildEmoteSet, chatSignals };
