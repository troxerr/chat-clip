#!/usr/bin/env node
"use strict";

const { openUrl } = require("../lib/open-url.js");
const crypto = require("node:crypto");
const http = require("node:http");

const DROPBOX = {
  authorize: "https://www.dropbox.com/oauth2/authorize",
  token: "https://api.dropboxapi.com/oauth2/token",
  profile: "https://api.dropboxapi.com/2/users/get_current_account",
  port: 53682,
  path: "/callback"
};

const GOOGLE = {
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  profile: "https://openidconnect.googleapis.com/v1/userinfo",
  port: 53683,
  path: "/oauth2callback"
};

function base64url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function createPkce() {
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function providerConfig(provider) {
  if (provider === "dropbox") return DROPBOX;
  if (provider === "google" || provider === "googleDrive") return GOOGLE;
  throw new Error(`Unsupported OAuth provider: ${provider}`);
}

function redirectUri(provider, port) {
  const config = providerConfig(provider);
  return `http://127.0.0.1:${port || config.port}${config.path}`;
}

function buildAuthorizeUrl(provider, { clientId, redirect, state, challenge }) {
  const config = providerConfig(provider);
  const url = new URL(config.authorize);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (provider === "dropbox") {
    url.searchParams.set("token_access_type", "offline");
  } else {
    url.searchParams.set("scope", "https://www.googleapis.com/auth/drive.file openid email");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  }
  return url.toString();
}

function openBrowser(url) {
  openUrl(url);
}

function serveCallback({ provider, port, state, timeoutMs = 300000 }) {
  const config = providerConfig(provider);
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, `http://127.0.0.1:${port}`);
      if (url.pathname !== config.path) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      const error = url.searchParams.get("error_description") || url.searchParams.get("error");
      const returnedState = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<!doctype html><meta charset=utf-8><title>ChatClip</title><body style='font:16px system-ui;padding:32px'><h1>Storage connected</h1><p>You can close this tab and return to ChatClip.</p></body>");
      server.close();
      if (error) return reject(new Error(error));
      if (returnedState !== state) return reject(new Error("OAuth state did not match."));
      if (!code) return reject(new Error("The provider did not return an authorization code."));
      resolve({ code });
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for the browser authorization."));
    }, timeoutMs);
    timer.unref?.();
    server.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.on("close", () => clearTimeout(timer));
    server.listen(port, "127.0.0.1");
  });
}

async function parseResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function exchangeToken(provider, {
  code,
  clientId,
  clientSecret = "",
  redirect,
  verifier,
  tokenUrl,
  fetchImpl = fetch
}) {
  const config = providerConfig(provider);
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    redirect_uri: redirect,
    grant_type: "authorization_code",
    code_verifier: verifier
  });
  if (clientSecret) body.set("client_secret", clientSecret);
  if (provider === "dropbox" && !clientSecret) {
    // Public-client PKCE refresh tokens are supported by Dropbox without a secret.
  }
  const response = await fetchImpl(tokenUrl || config.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(30000)
  });
  const data = await parseResponse(response);
  if (!response.ok || !data.refresh_token) {
    throw new Error(data.error_description || data.error || `Token exchange failed (${response.status}).`);
  }
  return data;
}

async function fetchProfile(provider, {
  accessToken,
  profileUrl,
  fetchImpl = fetch
}) {
  const config = providerConfig(provider);
  const url = profileUrl || config.profile;
  const options = {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000)
  };
  if (provider === "dropbox") {
    options.method = "POST";
    options.headers["Content-Type"] = "application/json";
    options.body = "null";
  }
  try {
    const response = await fetchImpl(url, options);
    const data = await parseResponse(response);
    if (!response.ok) return { account: "", displayName: "" };
    if (provider === "dropbox") {
      return {
        account: data.email || "",
        displayName: data.name && data.name.display_name ? data.name.display_name : ""
      };
    }
    return { account: data.email || "", displayName: data.name || "" };
  } catch {
    return { account: "", displayName: "" };
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "";
    args[key] = value;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const provider = String(args.provider || "").trim();
  const clientId = String(args["client-id"] || process.env.OAUTH_CLIENT_ID || "").trim();
  const clientSecret = String(args["client-secret"] || process.env.OAUTH_CLIENT_SECRET || "").trim();
  if (!provider || !clientId) throw new Error("oauth-bridge requires --provider and --client-id.");
  const config = providerConfig(provider);
  const port = Number(args.port) || config.port;
  const redirect = `http://127.0.0.1:${port}${config.path}`;
  const state = crypto.randomBytes(16).toString("hex");
  const { verifier, challenge } = createPkce();
  const authorize = buildAuthorizeUrl(provider, { clientId, redirect, state, challenge });

  const callback = serveCallback({ provider, port, state, timeoutMs: Number(args["timeout-ms"]) || 300000 });
  openBrowser(authorize);
  const { code } = await callback;
  const token = await exchangeToken(provider, {
    code,
    clientId,
    clientSecret,
    redirect,
    verifier,
    tokenUrl: args["token-url"],
    fetchImpl: fetch
  });
  const profile = await fetchProfile(provider, {
    accessToken: token.access_token,
    profileUrl: args["profile-url"],
    fetchImpl: fetch
  });
  process.stdout.write(JSON.stringify({
    ok: true,
    provider: provider === "google" ? "googleDrive" : provider,
    refreshToken: token.refresh_token,
    accessToken: token.access_token || "",
    account: profile.account,
    displayName: profile.displayName,
    scope: token.scope || ""
  }) + "\n");
}

if (require.main === module) {
  main().catch((error) => {
    process.stdout.write(JSON.stringify({ ok: false, error: error.message }) + "\n");
    process.exitCode = 1;
  });
}

module.exports = {
  DROPBOX,
  GOOGLE,
  base64url,
  createPkce,
  providerConfig,
  redirectUri,
  buildAuthorizeUrl,
  serveCallback,
  exchangeToken,
  fetchProfile,
  parseArgs
};
