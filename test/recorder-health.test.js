const test = require("node:test");
const assert = require("node:assert/strict");
const { restartDelay, isStalled, STALL_MS, RESTART_BASE_MS, RESTART_MAX_MS } = require("../lib/recorder-health.js");

test("the wait before a relaunch doubles and stops at five minutes", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((n) => restartDelay(n)), [15000, 30000, 60000, 120000, 240000]);
  assert.equal(restartDelay(5), RESTART_MAX_MS);
  assert.equal(restartDelay(500), RESTART_MAX_MS);
  assert.equal(restartDelay(-3), RESTART_BASE_MS);
  assert.equal(restartDelay(undefined), RESTART_BASE_MS);
});

test("a recorder is stalled only when video had flowed and then stopped for too long", () => {
  const now = 1_000_000;
  const base = { hasEncoder: true, now };
  assert.equal(isStalled({ ...base, lastFrameAt: now - STALL_MS - 1 }), true);
  assert.equal(isStalled({ ...base, lastFrameAt: now - STALL_MS + 1000 }), false);
  assert.equal(isStalled({ ...base, lastFrameAt: 0 }), false, "an offline channel never sent video");
});

test("nothing is stalled while stopping, restarting or without a recorder", () => {
  const stale = { now: 1_000_000, lastFrameAt: 1 };
  assert.equal(isStalled({ ...stale, hasEncoder: false }), false);
  assert.equal(isStalled({ ...stale, hasEncoder: true, restarting: true }), false);
  assert.equal(isStalled({ ...stale, hasEncoder: true, stopping: true }), false);
});
