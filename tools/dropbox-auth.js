#!/usr/bin/env node
"use strict";

const { openUrl } = require("../lib/open-url.js");
const { saveSecrets } = require("../lib/credentials.js");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");

const {
  readConfig,
  resolveConfigPath,
  defaultConfig,
  dropboxSettings
} = require("../lib/appconfig.js");

const REDIRECT_PORT = 53682;
const REDIRECT_PATH = "/callback";
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}${REDIRECT_PATH}`;
const AUTHORIZE_URL = "https://www.dropbox.com/oauth2/authorize";
const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const NO_REDIRECT = process.argv.includes("--no-redirect");

function openBrowser(url) {
  openUrl(url);
}

function waitForCode(state) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, REDIRECT_URI);
      if (url.pathname !== REDIRECT_PATH) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      const error = url.searchParams.get("error_description") || url.searchParams.get("error");
      const returnedState = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<!doctype html><meta charset=utf-8><title>Chatclip</title><body style='font:16px system-ui;padding:32px'><h1>Dropbox connected</h1><p>You can close this tab and return to the terminal.</p></body>");
      server.close();
      if (error) return reject(new Error(error));
      if (returnedState !== state) return reject(new Error("Dropbox OAuth state did not match."));
      if (!code) return reject(new Error("Dropbox did not return an authorization code."));
      resolve(code);
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for Dropbox authorization."));
    }, 300000);
    timer.unref?.();
    server.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.on("close", () => clearTimeout(timer));
    server.listen(REDIRECT_PORT, "127.0.0.1");
  });
}

async function exchangeCode(code, appKey, appSecret, redirectUri = REDIRECT_URI) {
  const parameters = {
    code,
    grant_type: "authorization_code",
    client_id: appKey,
    client_secret: appSecret
  };
  if (redirectUri) parameters.redirect_uri = redirectUri;
  const body = new URLSearchParams(parameters);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(30000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.refresh_token) {
    throw new Error(data.error_description || data.error || `Dropbox token exchange failed (${response.status}).`);
  }
  return data;
}

// `stored` lists credential names that were saved in the credential store; those
// fields are written blank so the config file never holds a second copy.
function mergeConfig(existing, { appKey, appSecret, refreshToken }, stored = []) {
  const base = defaultConfig();
  const next = { ...base, ...(existing && typeof existing === "object" ? existing : {}) };
  next.dropbox = {
    ...base.dropbox,
    ...((existing && existing.dropbox) || {}),
    enabled: true,
    appKey,
    appSecret: stored.includes("dropbox.appSecret") ? "" : appSecret,
    refreshToken: stored.includes("dropbox.refresh") ? "" : refreshToken
  };
  return next;
}

async function main() {
  const env = process.env;
  const configPath = resolveConfigPath(env);
  const loaded = readConfig({ env, filePath: configPath });
  if (loaded.error) console.warn(`Could not read ${configPath}: ${loaded.error}`);

  const current = dropboxSettings(loaded.config, env);
  let appKey = current.appKey || env.DROPBOX_APP_KEY || "";
  let appSecret = current.appSecret || env.DROPBOX_APP_SECRET || "";

  const prompt = readline.createInterface({ input: stdin, output: stdout });
  try {
    if (!appKey) appKey = (await prompt.question("Dropbox app key: ")).trim();
    if (!appSecret) appSecret = (await prompt.question("Dropbox app secret: ")).trim();
  } finally {
    prompt.close();
  }
  if (!appKey || !appSecret) throw new Error("Dropbox app key and app secret are required.");

  let token;
  if (NO_REDIRECT) {
    const authorize = new URL(AUTHORIZE_URL);
    authorize.searchParams.set("client_id", appKey);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("token_access_type", "offline");
    console.log("\nAuthorize Chatclip in Dropbox:");
    console.log(authorize.toString());
    console.log("\nAfter approving, Dropbox shows an authorization code. Copy it and paste it below.\n");
    openBrowser(authorize.toString());

    const codePrompt = readline.createInterface({ input: stdin, output: stdout });
    let code = "";
    try {
      code = (await codePrompt.question("Dropbox authorization code: ")).trim();
    } finally {
      codePrompt.close();
    }
    if (!code) throw new Error("No Dropbox authorization code was entered.");
    token = await exchangeCode(code, appKey, appSecret, null);
  } else {
    const state = crypto.randomBytes(16).toString("hex");
    const authorize = new URL(AUTHORIZE_URL);
    authorize.searchParams.set("client_id", appKey);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("token_access_type", "offline");
    authorize.searchParams.set("redirect_uri", REDIRECT_URI);
    authorize.searchParams.set("state", state);

    console.log("\nAuthorize Chatclip in Dropbox:");
    console.log(authorize.toString());
    console.log(`\nThe Dropbox app needs redirect URI ${REDIRECT_URI}`);
    console.log("and scopes files.content.write plus files.metadata.write.\n");
    const codePromise = waitForCode(state);
    openBrowser(authorize.toString());

    const code = await codePromise;
    token = await exchangeCode(code, appKey, appSecret, REDIRECT_URI);
  }

  const saved = saveSecrets({ "dropbox.refresh": token.refresh_token, "dropbox.appSecret": appSecret });
  const next = mergeConfig(loaded.config, { appKey, appSecret, refreshToken: token.refresh_token }, saved.stored);

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  try { fs.chmodSync(configPath, 0o600); } catch {}

  for (const failure of saved.failed) {
    console.warn(`\nCould not save ${failure.name} in the credential store (${failure.error}); it was kept in ${configPath} instead.`);
  }
  console.log(saved.stored.includes("dropbox.refresh")
    ? `\nSaved the Dropbox refresh token in the Windows credential store (encrypted for your user).`
    : `\nSaved the Dropbox refresh token to ${configPath}`);
  console.log("Restart capture (or restart Chatclip) to start uploading vertical clips.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nDropbox setup failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { mergeConfig };
