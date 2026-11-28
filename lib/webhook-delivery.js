"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { setTimeout: sleep } = require("node:timers/promises");
const { webhookSettings, readConfig } = require("./appconfig.js");
const { getSecret: readCredential } = require("./credentials.js");
const { defaultStateDir } = require("./jobstore.js");

const KEY_ACCOUNT = "webhook.key";
const LOG_LIMIT = 50;

function endpointUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Enter a valid HTTPS webhook URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("Enter an HTTPS webhook URL without embedded credentials or a fragment.");
  }
  return url.href;
}

function createWebhookDelivery({ readSettings = () => webhookSettings(readConfig().config), getSecret = readCredential, stateDir = defaultStateDir(), fetchImpl = fetch, delay = sleep }) {
  const logDir = path.join(stateDir, "webhook-deliveries");
  let pending = 0;

  function files() {
    return fs.readdirSync(logDir).filter((name) => /^\d{13}-[a-f0-9-]+\.json$/.test(name)).sort().reverse();
  }

  function log() {
    try {
      return files().slice(0, LOG_LIMIT).flatMap((name) => {
        try { return [JSON.parse(fs.readFileSync(path.join(logDir, name), "utf8"))]; } catch { return []; }
      });
    } catch { return []; }
  }

  function record(entry) {
    try {
      fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(logDir, `${Date.now()}-${entry.id}.json`), JSON.stringify(entry), { mode: 0o600 });
      for (const name of files().slice(LOG_LIMIT)) fs.rmSync(path.join(logDir, name), { force: true });
    } catch {}
    return entry;
  }

  async function deliver(payload, { test = false } = {}) {
    const settings = readSettings();
    if (!test && (!settings.enabled || !payload)) return null;
    const entry = { id: randomUUID(), event: payload.event, clipId: payload.clipId || null, at: new Date().toISOString(), attempts: 0 };
    let url;
    try { url = endpointUrl(settings.url); } catch (error) {
      return record({ ...entry, ok: false, error: error.message });
    }
    let key = "";
    if (settings.useKey) {
      try {
        const credential = JSON.parse(getSecret(KEY_ACCOUNT));
        if (endpointUrl(credential.url) === url && typeof credential.key === "string") key = credential.key;
      } catch {}
    }
    if (settings.useKey && !key) return record({ ...entry, ok: false, error: "The webhook key is unavailable. Save it again and retry." });
    if (pending >= 8) return record({ ...entry, ok: false, error: "Delivery queue is full." });
    pending++;
    try {
      const headers = { "content-type": "application/json", "x-clipspike-delivery": entry.id };
      if (settings.useKey) headers.authorization = `Bearer ${key}`;
      const body = JSON.stringify(payload);
      for (let attempt = 1; attempt <= 3; attempt++) {
        entry.attempts = attempt;
        let response;
        try {
          response = await fetchImpl(url, { method: "POST", headers, body, redirect: "error", signal: AbortSignal.timeout(5000) });
        } catch {
          entry.error = "Could not reach the webhook endpoint.";
        }
        if (response) {
          entry.status = response.status;
          void response.body?.cancel().catch(() => {});
          if (response.ok) {
            delete entry.error;
            return record({ ...entry, ok: true });
          }
          entry.error = `Endpoint returned HTTP ${response.status}.`;
          if (response.status !== 429 && response.status < 500) break;
        }
        if (attempt < 3) await delay(500 * attempt);
      }
      return record({ ...entry, ok: false });
    } finally {
      pending--;
    }
  }

  return {
    log,
    deliver,
    test: () => deliver({ version: 1, event: "webhook.test", timestamp: new Date().toISOString() }, { test: true })
  };
}

module.exports = { createWebhookDelivery, endpointUrl, KEY_ACCOUNT };
