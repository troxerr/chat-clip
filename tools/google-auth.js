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
  googleDriveSettings
} = require("../lib/appconfig.js");

const REDIRECT_PORT = 53683;
const REDIRECT_PATH = "/oauth2callback";
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}${REDIRECT_PATH}`;
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const SCOPE = "https://www.googleapis.com/auth/drive.file openid email";

function base64url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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
      response.end("<!doctype html><meta charset=utf-8><title>ChatClip</title><body style='font:16px system-ui;padding:32px'><h1>Google Drive connected</h1><p>You can close this tab and return to the terminal.</p></body>");
      server.close();
      if (error) return reject(new Error(error));
      if (returnedState !== state) return reject(new Error("Google OAuth state did not match."));
      if (!code) return reject(new Error("Google did not return an authorization code."));
      resolve(code);
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for Google authorization."));
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

async function exchangeCode(code, clientId, clientSecret, verifier) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
    code_verifier: verifier
  });
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(30000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.refresh_token) {
    throw new Error(data.error_description || data.error || `Google token exchange failed (${response.status}).`);
  }
  return data;
}

async function profileEmail(accessToken) {
  try {
    const response = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json().catch(() => ({}));
    return response.ok ? (data.email || "") : "";
  } catch {
    return "";
  }
}

// `stored` lists credential names that were saved in the credential store; those
// fields are written blank so the config file never holds a second copy.
function mergeConfig(existing, { clientId, clientSecret, refreshToken, email }, stored = []) {
  const base = defaultConfig();
  const next = { ...base, ...(existing && typeof existing === "object" ? existing : {}) };
  next.googleDrive = {
    ...base.googleDrive,
    ...((existing && existing.googleDrive) || {}),
    enabled: true,
    clientId,
    clientSecret: stored.includes("google.clientSecret") ? "" : clientSecret,
    refreshToken: stored.includes("google.refresh") ? "" : refreshToken,
    email
  };
  next.storage = {
    ...base.storage,
    ...((existing && existing.storage) || {}),
    mode: "googleDrive"
  };
  return next;
}

async function main() {
  const env = process.env;
  const configPath = resolveConfigPath(env);
  const loaded = readConfig({ env, filePath: configPath });
  if (loaded.error) console.warn(`Could not read ${configPath}: ${loaded.error}`);

  const current = googleDriveSettings(loaded.config, env);
  let clientId = current.clientId || env.GOOGLE_CLIENT_ID || "";
  let clientSecret = current.clientSecret || env.GOOGLE_CLIENT_SECRET || "";

  const prompt = readline.createInterface({ input: stdin, output: stdout });
  try {
    if (!clientId) clientId = (await prompt.question("Google OAuth client ID: ")).trim();
    if (!clientSecret) clientSecret = (await prompt.question("Google OAuth client secret: ")).trim();
  } finally {
    prompt.close();
  }
  if (!clientId || !clientSecret) throw new Error("Google OAuth client ID and client secret are required.");

  const state = crypto.randomBytes(16).toString("hex");
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  const authorize = new URL(AUTHORIZE_URL);
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", REDIRECT_URI);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", SCOPE);
  authorize.searchParams.set("access_type", "offline");
  authorize.searchParams.set("prompt", "consent");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");

  console.log("\nAuthorize ChatClip to create files in Google Drive:");
  console.log(authorize.toString());
  console.log(`\nThe Google OAuth client must allow redirect URI ${REDIRECT_URI}`);
  console.log("and the OAuth consent screen must be published for unattended use.\n");
  const codePromise = waitForCode(state);
  openBrowser(authorize.toString());

  const code = await codePromise;
  const token = await exchangeCode(code, clientId, clientSecret, verifier);
  const email = await profileEmail(token.access_token);
  const saved = saveSecrets({ "google.refresh": token.refresh_token, "google.clientSecret": clientSecret });
  const next = mergeConfig(loaded.config, { clientId, clientSecret, refreshToken: token.refresh_token, email }, saved.stored);

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  try { fs.chmodSync(configPath, 0o600); } catch {}

  for (const failure of saved.failed) {
    console.warn(`\nCould not save ${failure.name} in the credential store (${failure.error}); it was kept in ${configPath} instead.`);
  }
  console.log(saved.stored.includes("google.refresh")
    ? `\nSaved the Google Drive refresh token in the Windows credential store (encrypted for your user).`
    : `\nSaved the Google Drive refresh token to ${configPath}`);
  if (email) console.log(`Connected as ${email}`);
  console.log("Active storage is now Google Drive. Restart capture (or restart ChatClip).");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nGoogle Drive setup failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { mergeConfig };
