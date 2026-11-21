#!/usr/bin/env node
"use strict";

// Personal Mac relay. Expose ONLY port 8766 with a tunnel; 8765 stays local.
require("../lib/legacy.js").mirrorLegacyEnv();
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { keychainToken } = require("../lib/appconfig.js");
const { KickAPI, createKickRelay, readBody, reply } = require("../lib/kick-relay.js");

const clientId = process.env.KICK_CLIENT_ID || "01M7JRFG1KV0DR5ZP6D0ECMK4V";
const controlPort = Number(process.env.KICK_RELAY_PORT || 8765);
const webhookPort = Number(process.env.KICK_WEBHOOK_PORT || 8766);
const origin = `http://127.0.0.1:${controlPort}`;
const setupNonce = randomBytes(24).toString("hex");
let relay;
let setup;

function saveKeychain(account, secret) {
  if (process.platform !== "darwin") throw new Error("Use environment credentials on non-macOS systems.");
  const result = spawnSync("/usr/bin/security", ["add-generic-password", "-U", "-s", "com.chatclip.app.credentials", "-a", account, "-w", secret], { stdio: "ignore", timeout: 10000 });
  if (result.status !== 0) throw new Error("Could not save Kick credentials to Keychain.");
}
function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
  });
}
async function start(clientSecret, token) {
  const api = new KickAPI({ clientId, clientSecret });
  await api.token();
  relay = createKickRelay({ api, relayToken: token });
  await listen(relay.webhook, webhookPort);
  await listen(relay.control, controlPort);
  console.log(`Kick relay ready. Local control: ${origin}. Webhook origin: http://127.0.0.1:${webhookPort}`);
  console.log("Tunnel only the webhook port, then set the Kick app webhook URL to https://YOUR_TUNNEL/kick/webhook.");
}
async function main() {
  const secret = process.env.KICK_CLIENT_SECRET || keychainToken("kick.clientSecret");
  const token = process.env.CHATCLIP_KICK_RELAY_TOKEN || keychainToken("kick.relayToken");
  if (secret && token) return start(secret, token);
  let busy = false;
  const setupPath = `/setup/${setupNonce}`;
  setup = http.createServer(async (req, res) => {
    // Reject DNS rebinding, cross-origin form posts, and forwarded requests.
    if (req.headers.host !== `127.0.0.1:${controlPort}` || req.headers["x-forwarded-for"] || req.url !== setupPath) return reply(res, 404, { error: "Not found" });
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" });
      return res.end(`<!doctype html><html><meta charset="utf-8"><title>Pair Kick with ChatClip</title><style>body{font:17px system-ui;max-width:620px;margin:70px auto;padding:25px;background:#fafafa;color:#222}label,input,button{display:block}input{box-sizing:border-box;width:100%;padding:12px;margin:12px 0 24px}button{padding:12px 20px;background:#176a40;color:white;border:0;border-radius:6px}small{line-height:1.6}</style><h1>Pair Kick with ChatClip</h1><p>Save your Kick developer app secret in this Mac’s Keychain and test API access.</p><p>Application: <b>HighlightDesk</b></p><form method="post"><label>Client secret<input name="secret" type="password" required autocomplete="off" maxlength="512"></label><button>Save to Keychain and connect</button></form><p><small>The secret goes only to this local relay and Kick’s authentication endpoint. It is never included in the Mac app bundle or chat logs. A separate local pairing token is also saved to Keychain.</small></p></html>`);
    }
    if (req.method !== "POST" || req.headers.origin !== origin) return reply(res, 403, { error: "Forbidden" });
    if (busy) return reply(res, 409, { error: "Setup already in progress" });
    busy = true;
    try {
      const form = new URLSearchParams((await readBody(req, 4096)).toString("utf8"));
      const value = form.get("secret") || "";
      if (value.length < 8 || value.length > 512) throw new Error("Enter the developer app client secret.");
      const api = new KickAPI({ clientId, clientSecret: value });
      await api.token();
      const pairingToken = token || randomBytes(32).toString("hex");
      saveKeychain("kick.clientSecret", value);
      saveKeychain("kick.relayToken", pairingToken);
      reply(res, 200, { ok: true, message: "Kick credentials verified and saved in Keychain. Starting relay." });
      setup.close(async () => {
        try { await start(value, pairingToken); } catch (error) { console.error(error.message); process.exitCode = 1; }
      });
      setup.closeIdleConnections();
    } catch (error) { busy = false; reply(res, 400, { error: error.message }); }
  });
  await listen(setup, controlPort);
  const url = origin + setupPath;
  // A local setup link is a short-lived capability; keep it out of source control.
  const dir = path.join(__dirname, "..", ".local");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, "kick-setup-url.txt"), url + "\n", { mode: 0o600 });
  console.log(`Open this local setup page: ${url}`);
}
function stop() {
  relay?.close();
  relay?.control.close();
  relay?.webhook.close();
  setup?.close();
  setTimeout(() => process.exit(), 250).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
if (require.main === module) main().catch(error => { console.error(error.message); stop(); process.exitCode = 1; });

module.exports = { main };
