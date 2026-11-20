(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./config.js"));
  } else {
    root.HDReactions = factory(root.HDConfig);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (config) {
  "use strict";

  const REACTION_WORDS = /\b(?:l+o+l+|lmao+|lmfao+|omg|wtf|no way|clip (?:it|that)|insane|crazy|sheesh|bruh|pog(?:gers|champ)?|kekw?|lulw?|omegalul|monkas)\b/i;

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function quantile(sorted, q) {
    if (!sorted.length) return 0;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
    return sorted[index];
  }

  function evaluateReaction({ history = [], participants = 0, reactions = 0, settings = {} } = {}) {
    const merged = config.mergeSettings(settings);
    const values = history.map(Number).filter((value) => Number.isFinite(value) && value >= 0);
    const participantCount = Math.max(0, Number(participants) || 0);
    const reactionCount = Math.max(0, Number(reactions) || 0);

    if (values.length < merged.warmupWindows) {
      return {
        trigger: false,
        score: 0,
        threshold: 0,
        median: 0,
        reactionFloor: 0,
        reasons: [`warming up (${values.length}/${merged.warmupWindows} windows)`]
      };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const ceiling = quantile(sorted, 0.95);
    const baseline = values.map((value) => Math.min(value, ceiling));
    const middle = median(baseline);
    const mad = median(baseline.map((value) => Math.abs(value - middle))) * 1.4826;
    const adaptive = middle + merged.sensitivity * Math.max(2, 3 * mad, middle * 0.5);
    const threshold = Math.max(merged.minParticipants, middle * 1.5, adaptive);
    const reactionFloor = Math.max(merged.minReactions, Math.ceil(participantCount * merged.minReactionShare));

    const reasons = [];
    let trigger = true;
    if (participantCount < threshold) {
      trigger = false;
      reasons.push(`${participantCount} participants below ${round(threshold)} threshold`);
    }
    if (reactionCount < reactionFloor) {
      trigger = false;
      reasons.push(`${reactionCount} reactions below ${reactionFloor} required`);
    }
    if (trigger) {
      reasons.push(`${participantCount} participants above ${round(threshold)} threshold`);
      reasons.push(`${reactionCount} reactions (need ${reactionFloor})`);
    }

    return {
      trigger,
      score: round(participantCount / Math.max(1, middle)),
      threshold: round(threshold),
      median: round(middle),
      reactionFloor,
      reasons
    };
  }

  // Backwards-compatible wrapper for callers that only need a boolean.
  function strongReaction(history, participants, reactions, warmup = 12) {
    return evaluateReaction({
      history,
      participants,
      reactions,
      settings: { ...config.DEFAULTS, warmupWindows: warmup }
    }).trigger;
  }

  function isReaction(message, emotes) {
    const text = String(message || "");
    if (REACTION_WORDS.test(text)) return true;
    if (!emotes || typeof emotes.has !== "function") return false;
    return text.split(/\s+/).some((word) => emotes.has(word));
  }

  function collectEmotes(message, emotes, counts = new Map()) {
    if (!emotes || typeof emotes.has !== "function") return counts;
    for (const word of String(message || "").split(/\s+/)) {
      if (!word || !emotes.has(word)) continue;
      counts.set(word, (counts.get(word) || 0) + 1);
    }
    return counts;
  }

  function topEmotes(counts, limit = 3) {
    if (!counts || typeof counts.entries !== "function") return [];
    return [...counts.entries()]
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([name, count]) => ({ name, count }));
  }

  return {
    evaluateReaction,
    strongReaction,
    isReaction,
    collectEmotes,
    topEmotes,
    median,
    quantile
  };
});
