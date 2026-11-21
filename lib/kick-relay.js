"use strict";

const http = require("node:http");
const { verify, timingSafeEqual, randomBytes } = require("node:crypto");

function equalSecret(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && timingSafeEqual(x, y);
}

async function readBody(req, limit = 262144) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) { const error = new Error("Request too large"); error.status = 413; throw error; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function reply(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(body));
}

class KickAPI {
  constructor({ clientId, clientSecret, fetchImpl = fetch }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.fetch = fetchImpl;
    this.expires = 0;
  }
  async token() {
    if (this.accessToken && Date.now() < this.expires) return this.accessToken;
    if (!this.tokenPromise) this.tokenPromise = (async () => {
      const response = await this.fetch("https://id.kick.com/oauth/token", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: this.clientId, client_secret: this.clientSecret })
      });
      if (!response.ok) throw new Error(`Kick authentication failed (HTTP ${response.status}).`);
      const result = await response.json();
      if (!result.access_token) throw new Error("Kick returned no app access token.");
      this.accessToken = result.access_token;
      this.expires = Date.now() + Math.max(1, Number(result.expires_in || 3600) - 60) * 1000;
      return this.accessToken;
    })().finally(() => { this.tokenPromise = null; });
    return this.tokenPromise;
  }
  async request(route, { method = "GET", body } = {}, retry = true) {
    const token = await this.token();
    const response = await this.fetch(`https://api.kick.com/public/v1${route}`, {
      method, redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (response.status === 401 && retry) { this.expires = 0; return this.request(route, { method, body }, false); }
    if (!response.ok) throw new Error(`Kick API ${route.split("?")[0]} failed (HTTP ${response.status}).`);
    return response.status === 204 ? {} : response.json();
  }
  async subscribe(slug) {
    const lookup = async value => (await this.request(`/channels?slug=${encodeURIComponent(value)}`)).data?.[0];
    let channel = await lookup(slug);
    // Kick channel URLs use hyphens where usernames have underscores.
    if (!channel && slug.includes("_")) channel = await lookup(slug.replaceAll("_", "-"));
    if (!Number.isSafeInteger(channel?.broadcaster_user_id)) throw new Error("Kick channel not found.");
    const id = channel.broadcaster_user_id;
    const existing = (await this.request(`/events/subscriptions?broadcaster_user_id=${id}`)).data || [];
    const found = existing.some(item => item.event === "chat.message.sent" && Number(item.broadcaster_user_id) === id);
    if (!found) {
      const result = await this.request("/events/subscriptions", { method: "POST", body: {
        broadcaster_user_id: id, events: [{ name: "chat.message.sent", version: 1 }], method: "webhook"
      } });
      if (!result.data?.some(item => (item.name || item.event) === "chat.message.sent" && !item.error)) throw new Error("Kick did not confirm the chat subscription. Check webhooks in the developer app.");
    }
    return { id, slug };
  }
}

function createKickRelay({ api, relayToken, fetchImpl = fetch, now = Date.now, getPublicKey } = {}) {
  if (!relayToken || relayToken.length < 32) throw new Error("Relay token must be at least 32 characters.");
  const channels = new Map();
  const subscribing = new Map();
  const seen = new Map();
  const epoch = randomBytes(12).toString("hex");
  let sequence = 0;
  let publicKey;
  let keyFetchedAt = 0;
  let fetchingKey;
  async function key(force = false) {
    if (getPublicKey) return getPublicKey();
    if (publicKey && (!force || now() - keyFetchedAt < 30000) && now() - keyFetchedAt < 3600000) return publicKey;
    if (!fetchingKey) fetchingKey = (async () => {
      const response = await fetchImpl("https://api.kick.com/public/v1/public-key", { signal: AbortSignal.timeout(10000), redirect: "error" });
      if (!response.ok) throw new Error("Kick public key unavailable.");
      const body = await response.text();
      let value = body;
      if (!body.startsWith("-----BEGIN")) value = JSON.parse(body).data?.public_key;
      if (typeof value !== "string" || !value.includes("BEGIN PUBLIC KEY")) throw new Error("Invalid Kick public key.");
      publicKey = value; keyFetchedAt = now(); return value;
    })().finally(() => { fetchingKey = null; });
    return fetchingKey;
  }
  async function ensureChannel(slug) {
    if (channels.has(slug) && now() - channels.get(slug).checkedAt < 300000) return channels.get(slug);
    if (!subscribing.has(slug)) {
      if (channels.size >= 16 && !channels.has(slug)) throw new Error("Relay channel limit reached; restart to clear inactive channels.");
      subscribing.set(slug, (async () => {
        const existing = channels.get(slug);
        let info;
        try { info = await api.subscribe(slug); } catch (error) {
          // A failed recheck must not drop a working channel; retry in 30 seconds.
          if (!existing) throw error;
          existing.checkedAt = now() - 270000;
          return existing;
        }
        const state = existing || { ...info, events: [], pruned: 0, lastWebhookAt: null };
        state.checkedAt = now(); channels.set(slug, state); return state;
      })().finally(() => subscribing.delete(slug)));
    }
    return subscribing.get(slug);
  }
  // Sequence numbers are global, so track per channel the newest sequence dropped.
  function trim(state) {
    const keep = state.events.filter(item => now() - item.receivedAt < 30000).slice(-20000);
    const kept = new Set(keep);
    for (const item of state.events) if (!kept.has(item)) state.pruned = Math.max(state.pruned, item.sequence);
    state.events = keep;
  }
  async function control(req, res) {
    if (!equalSecret(req.headers.authorization, `Bearer ${relayToken}`)) return reply(res, 401, { error: "Unauthorized" });
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") return reply(res, 200, { ok: true, epoch, channels: channels.size, received: sequence });
    const match = /^\/v1\/(channels|events)\/([a-z0-9_-]{1,25})$/.exec(url.pathname);
    if (req.method !== "GET" || !match) return reply(res, 404, { error: "Not found" });
    try {
      const state = await ensureChannel(match[2]);
      if (match[1] === "channels") return reply(res, 200, { cursor: sequence, epoch, broadcasterId: state.id });
      const after = Number(url.searchParams.get("after"));
      if (!Number.isSafeInteger(after) || after < 0) return reply(res, 400, { error: "Invalid cursor" });
      const reset = url.searchParams.get("epoch") !== epoch || after > sequence || after < state.pruned;
      const entries = reset ? [] : state.events.filter(item => item.sequence > after && now() - item.receivedAt < 15000);
      reply(res, 200, { cursor: sequence, epoch, reset: Boolean(reset), events: entries.map(item => item.payload), lastWebhookAt: state.lastWebhookAt });
    } catch (error) { reply(res, 503, { error: error.message }); }
  }
  async function webhook(req, res) {
    if (req.method !== "POST" || req.url !== "/kick/webhook") return reply(res, 404, { error: "Not found" });
    try {
      const body = await readBody(req);
      const id = req.headers["kick-event-message-id"];
      const timestamp = req.headers["kick-event-message-timestamp"];
      const signature = req.headers["kick-event-signature"];
      if (typeof id !== "string" || id.length > 128 || typeof timestamp !== "string" || typeof signature !== "string"
          || !Number.isFinite(Date.parse(timestamp)) || Math.abs(now() - Date.parse(timestamp)) > 300000) return reply(res, 401, { error: "Invalid event headers" });
      const signed = Buffer.concat([Buffer.from(`${id}.${timestamp}.`), body]);
      let valid = verify("RSA-SHA256", signed, await key(), Buffer.from(signature, "base64"));
      if (!valid) valid = verify("RSA-SHA256", signed, await key(true), Buffer.from(signature, "base64"));
      if (!valid) return reply(res, 401, { error: "Invalid signature" });
      for (const [entry, at] of seen) if (now() - at > 300000) seen.delete(entry);
      if (seen.has(id)) return reply(res, 200, { duplicate: true });
      let payload;
      try { payload = JSON.parse(body.toString("utf8")); } catch { return reply(res, 400, { error: "Invalid event body" }); }
      if (req.headers["kick-event-type"] !== "chat.message.sent" || req.headers["kick-event-version"] !== "1") return reply(res, 200, { ignored: true });
      const state = [...channels.values()].find(channel => channel.id === payload?.broadcaster?.user_id);
      if (!state) return reply(res, 200, { ignored: true });
      seen.set(id, now());
      if (seen.size > 100000) seen.delete(seen.keys().next().value);
      // Keep only fields needed for detection. No email, avatars, or raw chat logs.
      const event = { message_id: payload.message_id, created_at: payload.created_at, content: payload.content,
        sender: { user_id: payload.sender?.user_id, is_anonymous: payload.sender?.is_anonymous, identity: { badges: payload.sender?.identity?.badges || [] } },
        broadcaster: { user_id: state.id, channel_slug: state.slug } };
      state.lastWebhookAt = now();
      state.events.push({ sequence: ++sequence, receivedAt: now(), payload: event });
      trim(state);
      reply(res, 200, { ok: true });
    } catch (error) { reply(res, error.status || 503, { error: error.status ? error.message : "Event verification unavailable" }); }
  }
  const makeServer = handler => {
    const server = http.createServer((req, res) => { Promise.resolve(handler(req, res)).catch(() => { if (!res.headersSent) reply(res, 500, { error: "Relay error" }); else res.end(); }); });
    server.requestTimeout = 20000;
    server.headersTimeout = 10000;
    return server;
  };
  const prune = setInterval(() => {
    for (const state of channels.values()) trim(state);
  }, 10000);
  prune.unref();
  return { control: makeServer(control), webhook: makeServer(webhook), close() { clearInterval(prune); } };
}

module.exports = { KickAPI, createKickRelay, equalSecret, readBody, reply };
