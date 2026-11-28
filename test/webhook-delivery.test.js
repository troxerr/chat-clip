const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { clipPayload } = require("../lib/clip-webhook.js");
const { createWebhookDelivery, endpointUrl } = require("../lib/webhook-delivery.js");

test("clip event includes a versioned aspect, actual layout, and optional links", () => {
  const payload = clipPayload("clip.uploaded", {
    id: "clip-1", channel: "channel", detectedAt: "2026-11-28T00:00:00.000Z",
    score: 5, vertical: { layout: "split" }
  }, { localPath: path.resolve("a clip.mp4"), cloudUrl: "https://cloud.example/clip" });
  assert.equal(payload.version, 1);
  assert.equal(payload.clipId, "clip-1");
  assert.equal(payload.spikeScore, 5);
  assert.equal(payload.aspect, "9:16");
  assert.equal(payload.preset, "split");
  assert.match(payload.localUrl, /a%20clip\.mp4$/);
  assert.equal(payload.cloudUrl, "https://cloud.example/clip");
});

test("test delivery retries with a stable ID and logs no endpoint or key", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "clipspike-webhook-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const calls = [];
  const delivery = createWebhookDelivery({
    readSettings: () => ({ enabled: false, useKey: true, url: "https://example.com/private-endpoint" }),
    getSecret: () => JSON.stringify({ url: "https://example.com/private-endpoint", key: "private-key" }),
    delay: async () => {},
    stateDir,
    fetchImpl: async (_url, options) => {
      calls.push(options);
      return new Response(null, { status: calls.length === 1 ? 429 : 204 });
    }
  });
  assert.equal(await delivery.deliver({ event: "clip.saved" }), null);
  const result = await delivery.test();
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(calls[0].headers.authorization, "Bearer private-key");
  assert.equal(calls[0].headers["x-clipspike-delivery"], calls[1].headers["x-clipspike-delivery"]);
  assert.equal(calls[0].redirect, "error");
  assert.doesNotMatch(JSON.stringify(delivery.log()), /private-endpoint|private-key/);
  assert.deepEqual(delivery.log(), [result]);
  assert.throws(() => endpointUrl("https://user:secret@example.com/"), /without embedded credentials/);
});

test("a stored key is never sent to a different endpoint", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "clipspike-webhook-key-"));
  try {
    let sent = false;
    const delivery = createWebhookDelivery({
      readSettings: () => ({ enabled: true, useKey: true, url: "https://new.example.com/" }),
      getSecret: () => JSON.stringify({ url: "https://old.example.com/", key: "private-key" }),
      fetchImpl: async () => { sent = true; },
      stateDir
    });
    assert.equal((await delivery.test()).ok, false);
    assert.equal(sent, false);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
