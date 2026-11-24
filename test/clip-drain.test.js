const test = require("node:test");
const assert = require("node:assert/strict");
const { drainClips } = require("../lib/clip-drain.js");

test("a waiting clip is flushed and awaited", async () => {
  let pending = true; let exp = null; const calls = [];
  const ok = await drainClips({
    hasPending: () => pending, getExport: () => exp,
    flush: async () => { pending = false; exp = new Promise((r) => setTimeout(() => { exp = null; r(); }, 20)); await exp; },
    onUnfinished: (m) => calls.push(m), timeoutMs: 500
  });
  assert.equal(ok, true); assert.deepEqual(calls, []);
});

test("an export in progress is awaited without flushing again", async () => {
  let exp = new Promise((r) => setTimeout(() => { exp = null; r(); }, 20)); let flushed = false;
  const ok = await drainClips({ hasPending: () => false, getExport: () => exp, flush: async () => { flushed = true; }, onUnfinished() {}, timeoutMs: 500 });
  assert.equal(ok, true); assert.equal(flushed, false);
});

test("a clip that takes too long is reported and the wait ends", async () => {
  const calls = []; const exp = new Promise(() => {});
  const started = Date.now();
  const ok = await drainClips({ hasPending: () => false, getExport: () => exp, flush: async () => {}, onUnfinished: (m) => calls.push(m), timeoutMs: 50 });
  assert.equal(ok, false); assert.equal(calls.length, 1); assert.ok(Date.now() - started < 1000);
});

test("nothing to finish returns at once", async () => {
  assert.equal(await drainClips({ hasPending: () => false, getExport: () => null, flush: async () => {}, onUnfinished() {} }), true);
});
