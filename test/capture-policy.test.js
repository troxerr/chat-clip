const test = require("node:test");
const assert = require("node:assert/strict");
const { reconnectDelay, overlapsClip } = require("../lib/capture-policy.js");

test("Twitch reconnect delay grows with jitter and caps at 30 seconds", () => {
  assert.equal(reconnectDelay(0, () => 0), 500);
  assert.equal(reconnectDelay(3, () => 0.5), 6000);
  assert.equal(reconnectDelay(100, () => 1), 30000);
});

test("automatic highlights reject overlapping windows within one recorder session", () => {
  const previous = { start: 15, end: 30, recordToken: 1 };
  assert.equal(overlapsClip(previous, { start: 25, end: 40, recordToken: 1 }), true);
  assert.equal(overlapsClip(previous, { start: 30, end: 45, recordToken: 1 }), false);
  assert.equal(overlapsClip(previous, { start: 25, end: 40, recordToken: 2 }), false);
});
