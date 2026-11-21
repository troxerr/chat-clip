"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, sign } = require("node:crypto");
const { Readable } = require("node:stream");
const { parseSource } = require("../lib/stream-source.js");
const { normalizeKickMessage, relaySettings, connectKickChat } = require("../lib/kick-chat.js");
const { createKickRelay, KickAPI } = require("../lib/kick-relay.js");
const { isPrivileged } = require("../dist/irc.js");
const { isReaction, evaluateReaction } = require("../dist/reactions.js");
const policy = require("../lib/monitor-policy.js");

const now = Date.now();
const payload = (overrides = {}) => ({ message_id: "m1", created_at: new Date(now).toISOString(), content: "[emote:37226:KEKW]",
  broadcaster: { user_id: 123, channel_slug: "example" }, sender: { user_id: 456, identity: { badges: [] } }, ...overrides });

test("channel parsing isolates platforms and rejects other sites, VODs, and traversal", () => {
  assert.equal(parseSource("Example").key, "example");
  assert.equal(parseSource("https://www.twitch.tv/Example/").key, "example");
  assert.equal(parseSource("https://kick.com/example").key, "kick--example");
  assert.equal(parseSource("kick:some-name").slug, "some-name");
  for (const bad of ["https://kick.com.evil/example", "https://kick.com/example/clips/1", "../example", "https://twitch.tv/videos/123", "kick:", "https://evil.com/example"]) assert.throws(() => parseSource(bad));
  assert.notEqual(policy.channelKey("kick--example"), policy.channelKey("example"));
  assert.throws(() => policy.channelKey("kick--../bad"));
});

test("Kick messages preserve unique users and native emotes for automatic spikes", () => {
  const messages = Array.from({ length: 40 }, (_, i) => normalizeKickMessage(payload({ message_id: String(i), sender: { user_id: 1000 + i } }), "example", now));
  const emotes = new Set(messages.flatMap(m => m.emotes));
  const participants = new Set(messages.map(m => m.nick)).size;
  const reactions = messages.filter(m => isReaction(m.text, emotes)).length;
  assert.equal(participants, 40);
  assert.equal(evaluateReaction({ history: Array(12).fill(10), participants, reactions, settings: policy.ROOT }).trigger, true);
});

test("only moderator or broadcaster IDs grant Kick command privileges", () => {
  const viewer = normalizeKickMessage(payload({ content: "!clip" }), "example", now);
  assert.equal(isPrivileged(viewer.tags, viewer.nick, viewer.channel), false);
  const mod = normalizeKickMessage(payload({ sender: { user_id: 456, identity: { badges: [{ type: "moderator" }] } } }), "example", now);
  assert.equal(isPrivileged(mod.tags, mod.nick, mod.channel), true);
  const owner = normalizeKickMessage(payload({ sender: { user_id: 123 } }), "example", now);
  assert.equal(isPrivileged(owner.tags, owner.nick, owner.channel), true);
});

test("stale events, anonymous senders, and wrong channels cannot trigger clips", () => {
  assert.equal(normalizeKickMessage(payload(), "other", now), null);
  assert.equal(normalizeKickMessage(payload({ created_at: new Date(now - 16000).toISOString() }), "example", now), null);
  assert.equal(normalizeKickMessage(payload({ sender: { user_id: 1, is_anonymous: true } }), "example", now), null);
  assert.equal(normalizeKickMessage(payload({ created_at: "invalid" }), "example", now), null);
});

test("relay credentials never travel to insecure remote origins", () => {
  const env = { HIGHLIGHT_DESK_KEYCHAIN: "0", HIGHLIGHT_DESK_KICK_RELAY_TOKEN: "test" };
  assert.equal(relaySettings({}, env).url, "http://127.0.0.1:8765");
  for (const url of ["http://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com?token=1"]) assert.throws(() => relaySettings({ kick: { relayUrl: url } }, env));
});

async function call(server, url, { headers = {}, body = "", method = "GET" } = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  Object.assign(req, { url, headers, method });
  return new Promise(resolve => {
    const res = { headersSent: false, writeHead(status) { this.status = status; this.headersSent = true; }, end(value) { resolve({ status: this.status, data: JSON.parse(value || "{}") }); } };
    server.emit("request", req, res);
  });
}
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const relayToken = "a".repeat(64);
const auth = { authorization: `Bearer ${relayToken}` };
function fixture(t) {
  const api = { subscribe: async slug => ({ id: 123, slug }) };
  const relay = createKickRelay({ api, relayToken, now: () => now, getPublicKey: () => keys.publicKey });
  t.after(() => relay.close());
  return relay;
}
function signed(body, id = "event-1") {
  const timestamp = new Date(now).toISOString();
  return { "kick-event-message-id": id, "kick-event-message-timestamp": timestamp,
    "kick-event-signature": sign("RSA-SHA256", Buffer.from(`${id}.${timestamp}.${body}`), keys.privateKey).toString("base64"),
    "kick-event-type": "chat.message.sent", "kick-event-version": "1" };
}

test("relay verifies raw-body signatures, rejects tampering, and deduplicates delivery", async t => {
  const relay = fixture(t);
  assert.equal((await call(relay.control, "/v1/channels/example")).status, 401);
  const start = (await call(relay.control, "/v1/channels/example", { headers: auth })).data;
  const body = JSON.stringify(payload());
  const headers = signed(body);
  assert.equal((await call(relay.webhook, "/kick/webhook", { method: "POST", body: body + " ", headers })).status, 401);
  assert.equal((await call(relay.webhook, "/kick/webhook", { method: "POST", body, headers })).status, 200);
  assert.equal((await call(relay.webhook, "/kick/webhook", { method: "POST", body, headers })).data.duplicate, true);
  const batch = (await call(relay.control, `/v1/events/example?after=0&epoch=${start.epoch}`, { headers: auth })).data;
  assert.equal(batch.events.length, 1);
  assert.equal(batch.events[0].content, payload().content);
  assert.equal(batch.events[0].sender.username, undefined);
  assert.equal((await call(relay.webhook, "/v1/events/example", { headers: auth })).status, 404);
});

test("relay restart resets cursors without replaying old chat into detection", async t => {
  const relay = fixture(t);
  await call(relay.control, "/v1/channels/example", { headers: auth });
  const result = (await call(relay.control, "/v1/events/example?after=42&epoch=previous-instance", { headers: auth })).data;
  assert.equal(result.reset, true);
  assert.deepEqual(result.events, []);
});

test("expired webhook signatures are rejected", async t => {
  const relay = fixture(t);
  const body = JSON.stringify(payload());
  const headers = signed(body);
  headers["kick-event-message-timestamp"] = new Date(now - 600000).toISOString();
  assert.equal((await call(relay.webhook, "/kick/webhook", { method: "POST", body, headers })).status, 401);
});

test("app token refresh retries unauthorized API calls once without disclosing credentials", async () => {
  let tokens = 0, calls = 0;
  const api = new KickAPI({ clientId: "id", clientSecret: "secret", fetchImpl: async (url, options) => {
    if (url.includes("oauth/token")) { tokens++; assert.equal(options.body.get("grant_type"), "client_credentials"); return { ok: true, json: async () => ({ access_token: `token-${tokens}`, expires_in: 3600 }) }; }
    calls++;
    return calls === 1 ? { ok: false, status: 401 } : { ok: true, json: async () => ({ data: [] }) };
  } });
  await api.request("/channels?slug=example");
  assert.equal(tokens, 2);
  assert.equal(calls, 2);
});

test("poller drops duplicate events and shuts down without scheduling reconnect", async () => {
  let client;
  const messages = [];
  let requests = 0;
  await new Promise((resolve, reject) => {
    client = connectKickChat({ slug: "example", relay: { url: "http://127.0.0.1:8765", token: relayToken },
      onState() {}, onMessage(event) { messages.push(event); client.close(); resolve(); },
      fetchImpl: async () => ({ ok: true, json: async () => ++requests === 1 ? { cursor: 0, epoch: "one" } : { cursor: 1, epoch: "one", events: [payload(), payload()] } }) });
    setTimeout(() => { client.close(); reject(new Error("poller did not deliver")); }, 100).unref();
  });
  // Closing inside a callback also stops delivery of the rest of that batch.
  assert.equal(messages.length, 1);
});

test("subscribe accepts Kick's POST response shape (name, not event)", async () => {
  const calls = [];
  const api = new KickAPI({ clientId: "id", clientSecret: "s", fetchImpl: async (url, options = {}) => {
    if (url.includes("oauth/token")) return { ok: true, json: async () => ({ access_token: "t", expires_in: 3600 }) };
    calls.push(`${options.method || "GET"} ${url.replace("https://api.kick.com/public/v1", "")}`);
    const data = url.includes("/channels") ? [{ broadcaster_user_id: 123 }] : options.method === "POST" ? [{ name: "chat.message.sent", version: 1, subscription_id: "x" }] : [];
    return { ok: true, status: 200, json: async () => ({ data }) };
  } });
  assert.deepEqual(await api.subscribe("example"), { id: 123, slug: "example" });
  assert.ok(calls.includes("GET /events/subscriptions?broadcaster_user_id=123"));
  const failing = new KickAPI({ clientId: "id", clientSecret: "s", fetchImpl: async (url, options = {}) => url.includes("oauth/token")
    ? { ok: true, json: async () => ({ access_token: "t" }) }
    : { ok: true, status: 200, json: async () => ({ data: url.includes("/channels") ? [{ broadcaster_user_id: 1 }] : options.method === "POST" ? [{ name: "chat.message.sent", error: "nope" }] : [] }) } });
  await assert.rejects(failing.subscribe("example"));
});

test("traffic on another channel does not cause a false cursor reset", async t => {
  const api = { subscribe: async slug => ({ id: slug === "example" ? 123 : 999, slug }) };
  const relay = createKickRelay({ api, relayToken, now: () => now, getPublicKey: () => keys.publicKey });
  t.after(() => relay.close());
  const start = (await call(relay.control, "/v1/channels/example", { headers: auth })).data;
  await call(relay.control, "/v1/channels/other", { headers: auth });
  const send = async (user, id) => {
    const body = JSON.stringify(payload({ message_id: id, broadcaster: { user_id: user } }));
    assert.equal((await call(relay.webhook, "/kick/webhook", { method: "POST", body, headers: signed(body, id) })).status, 200);
  };
  await send(999, "o1"); await send(999, "o2"); await send(123, "e1");
  const batch = (await call(relay.control, `/v1/events/example?after=${start.cursor}&epoch=${start.epoch}`, { headers: auth })).data;
  assert.equal(batch.reset, false);
  assert.equal(batch.events.length, 1);
});

test("malformed signed webhook body is a 400, not a retryable 503", async t => {
  const relay = fixture(t);
  await call(relay.control, "/v1/channels/example", { headers: auth });
  const body = "not json";
  assert.equal((await call(relay.webhook, "/kick/webhook", { method: "POST", body, headers: signed(body, "bad") })).status, 400);
});

test("a failed subscription recheck keeps serving an already-working channel", async t => {
  let fail = false, t0 = now;
  const api = { subscribe: async slug => { if (fail) throw new Error("kick down"); return { id: 123, slug }; } };
  const relay = createKickRelay({ api, relayToken, now: () => t0, getPublicKey: () => keys.publicKey });
  t.after(() => relay.close());
  const start = (await call(relay.control, "/v1/channels/example", { headers: auth })).data;
  fail = true; t0 += 301000;
  const res = await call(relay.control, `/v1/events/example?after=${start.cursor}&epoch=${start.epoch}`, { headers: auth });
  assert.equal(res.status, 200);
  assert.equal(res.data.reset, false);
});
