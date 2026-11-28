"use strict";

function reconnectDelay(attempt, random = Math.random) {
  const ceiling = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
  return Math.round(ceiling * (0.5 + 0.5 * random()));
}

function overlapsClip(previous, next) {
  return Boolean(previous && previous.recordToken === next.recordToken &&
    next.start < previous.end && previous.start < next.end);
}

module.exports = { reconnectDelay, overlapsClip };
