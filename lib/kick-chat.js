"use strict";

// Accept only authenticated relay events. Do not collect reply authors as chatters.
function normalizeKickMessage(payload, slug, now = Date.now()) {
  const sender = payload?.sender;
  const broadcaster = payload?.broadcaster;
  const createdAt = Date.parse(payload?.created_at);
  if (!payload?.message_id || !sender?.user_id || !broadcaster?.user_id || sender.is_anonymous
      || typeof payload.content !== "string" || !Number.isFinite(createdAt)
      || now - createdAt > 15000 || createdAt - now > 5000) return null;
  if (String(broadcaster.channel_slug || broadcaster.username).toLowerCase() !== slug) return null;
  const emotes = [];
  const text = payload.content.slice(0, 10000).replace(/\[emote:\d+:([^\]\r\n]{1,100})\]/g, (_, name) => {
    emotes.push(name); return name;
  });
  const moderator = (sender.identity?.badges || []).some(b => b.type === "moderator");
  const owner = String(sender.user_id) === String(broadcaster.user_id);
  return { type: "chat", channel: `kick--${slug}`, nick: `kick-user-${sender.user_id}`,
    text, emotes, id: String(payload.message_id), createdAt,
    tags: { mod: moderator || owner ? "1" : "0" } };
}

function relaySettings(config = {}, env = process.env) {
  const { keychainToken } = require("./appconfig.js");
  const url = env.CLIPSPIKE_KICK_RELAY || config.kick?.relayUrl || "http://127.0.0.1:8765";
  const parsed = new URL(url);
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") throw new Error("Kick relay URL must be an origin without credentials or a path.");
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))) throw new Error("Remote Kick relays must use HTTPS.");
  const token = env.CLIPSPIKE_KICK_RELAY_TOKEN || keychainToken("kick.relayToken", env);
  return { url: parsed.origin, token };
}

function connectKickChat({ slug, relay, onMessage, onState, fetchImpl = fetch }) {
  let closed = false;
  let cursor = null;
  let epoch = "";
  let timer;
  let controller;
  const seen = new Set();
  async function request(route) {
    controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetchImpl(relay.url + route, { headers: { Authorization: `Bearer ${relay.token}` }, signal: controller.signal, redirect: "error" });
      if (!res.ok) throw new Error(`Kick relay returned HTTP ${res.status}. Check the relay and developer app webhook configuration.`);
      return await res.json();
    } finally { clearTimeout(timeout); }
  }
  async function poll() {
    try {
      if (cursor === null) {
        const status = await request(`/v1/channels/${slug}`);
        cursor = status.cursor;
        epoch = status.epoch;
        if (!Number.isSafeInteger(cursor)) throw new Error("Invalid Kick relay cursor.");
      }
      const batch = await request(`/v1/events/${slug}?after=${cursor}&epoch=${encodeURIComponent(epoch)}`);
      if (!Number.isSafeInteger(batch.cursor) || !Array.isArray(batch.events)) throw new Error("Invalid Kick relay response.");
      if (closed) return;
      if (batch.reset) { seen.clear(); onState(false, "Kick chat delivery gap; rebuilding baseline."); }
      cursor = batch.cursor;
      epoch = batch.epoch;
      onState(true, "Kick chat connected");
      for (const item of batch.events) {
        if (closed) break;
        const event = normalizeKickMessage(item, slug);
        if (!event || seen.has(event.id)) continue;
        seen.add(event.id);
        if (seen.size > 10000) seen.delete(seen.values().next().value);
        onMessage(event);
      }
    } catch (error) {
      if (closed) return;
      cursor = null;
      onState(false, error.message);
    } finally { if (!closed) timer = setTimeout(poll, cursor === null ? 5000 : 750); }
  }
  if (!relay.token) throw new Error("Kick relay is not paired. Run npm run kick:relay and complete its local setup first.");
  poll();
  return { close() { closed = true; clearTimeout(timer); controller?.abort(); } };
}

module.exports = { normalizeKickMessage, relaySettings, connectKickChat };
