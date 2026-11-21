"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { normalizeFolder } = require("./appconfig.js");

const { LEGACY_DRIVE_FOLDERS } = require("./legacy.js");

const APP_FOLDER = "ClipSpike";
const MAX_SIMPLE_UPLOAD = 150 * 1024 * 1024;

class DropboxError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "DropboxError";
    this.status = details.status || 0;
    this.summary = details.summary || "";
    this.body = details.body || null;
  }
}

function joinDropboxPath(...parts) {
  const joined = parts
    .filter((part) => part !== undefined && part !== null && String(part) !== "")
    .map((part) => String(part).trim())
    .join("/")
    .replace(/\/+/g, "/");
  const absolute = joined.startsWith("/") ? joined : "/" + joined;
  return absolute.length > 1 ? absolute.replace(/\/$/, "") : "/";
}

function asciiJson(value) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (character) => {
    return "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0");
  });
}

function parseRetryAfter(response, attempt) {
  try {
    const header = response.headers && typeof response.headers.get === "function"
      ? response.headers.get("retry-after")
      : null;
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  } catch {}
  return Math.min(8000, 500 * 2 ** attempt);
}

async function parseBody(response) {
  try {
    const text = await response.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function createDropboxClient(settings, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("No fetch implementation is available.");
  const apiBase = (settings.apiBase || options.apiBase || "https://api.dropboxapi.com").replace(/\/$/, "");
  const contentBase = (settings.contentBase || options.contentBase || "https://content.dropboxapi.com").replace(/\/$/, "");
  const tokenUrl = settings.tokenUrl || options.tokenUrl || `${apiBase}/oauth2/token`;
  const now = options.now || Date.now;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxAttempts = Math.max(1, options.maxAttempts || 3);
  const uploadTimeoutMs = options.uploadTimeoutMs || 180000;
  const canRefresh = Boolean(settings.refreshToken && settings.appKey);

  if (!canRefresh && !settings.accessToken) {
    throw new DropboxError("Dropbox is not configured.");
  }

  let cachedToken = settings.accessToken || "";
  let expiresAt = settings.accessToken ? Infinity : 0;
  let refreshPromise = null;

  async function refreshAccessToken() {
    if (!canRefresh) throw new DropboxError("Dropbox access token expired and no refresh token is configured.");
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: settings.refreshToken,
        client_id: settings.appKey
      });
      // Dropbox PKCE public clients refresh without a client secret.
      if (settings.appSecret) body.set("client_secret", settings.appSecret);
      const response = await fetchImpl(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(30000)
      });
      const data = await parseBody(response);
      if (!response.ok || !data.access_token) {
        throw new DropboxError(
          data.error_description || data.error || `Dropbox token refresh failed (${response.status}).`,
          { status: response.status, body: data }
        );
      }
      cachedToken = data.access_token;
      const lifetime = Number(data.expires_in);
      expiresAt = now() + Math.max(60, (Number.isFinite(lifetime) ? lifetime : 14400) - 60) * 1000;
      return cachedToken;
    })().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  async function getAccessToken(force = false) {
    if (!force && cachedToken && now() < expiresAt) return cachedToken;
    if (canRefresh) return refreshAccessToken();
    if (settings.accessToken) {
      cachedToken = settings.accessToken;
      expiresAt = Infinity;
      return cachedToken;
    }
    throw new DropboxError("Dropbox credentials are missing.");
  }

  function retryable(status) {
    return status === 429 || status >= 500;
  }

  async function apiRequest(endpoint, payload, attempt = 0) {
    const token = await getAccessToken();
    const response = await fetchImpl(`${apiBase}/2/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000)
    });

    if (response.status === 401 && canRefresh && attempt === 0) {
      await getAccessToken(true);
      return apiRequest(endpoint, payload, attempt + 1);
    }
    if (retryable(response.status) && attempt < maxAttempts - 1) {
      await sleep(parseRetryAfter(response, attempt));
      return apiRequest(endpoint, payload, attempt + 1);
    }

    const data = await parseBody(response);
    if (!response.ok) {
      throw new DropboxError(data.error_summary || `Dropbox request failed (${response.status}).`, {
        status: response.status,
        summary: data.error_summary || "",
        body: data
      });
    }
    return data;
  }

  async function ensureFolder(folder) {
    const normalized = normalizeFolder(folder);
    if (normalized === "/") return;
    const parts = normalized.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = joinDropboxPath(current, part);
      try {
        await apiRequest("files/create_folder_v2", { path: current, autorename: false });
      } catch (error) {
        // A 409 here means the folder already exists (or a file occupies the path).
        // In the latter case the upload below fails cleanly and the local clip is kept.
        if (error instanceof DropboxError && error.status === 409) continue;
        throw error;
      }
    }
  }

  async function uploadFile(localPath, remotePath, attempt = 0, retriedFolder = false) {
    const stat = fs.statSync(localPath);
    if (stat.size > MAX_SIMPLE_UPLOAD) {
      throw new DropboxError(`Clip is too large for a single Dropbox upload (${stat.size} bytes).`);
    }
    const contents = fs.readFileSync(localPath);
    const remoteFolder = path.posix.dirname(remotePath);
    await ensureFolder(remoteFolder);

    const token = await getAccessToken();
    const arg = asciiJson({
      path: remotePath,
      mode: { ".tag": "add" },
      autorename: true,
      mute: false,
      strict_conflict: false
    });
    const response = await fetchImpl(`${contentBase}/2/files/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": arg
      },
      body: contents,
      signal: AbortSignal.timeout(uploadTimeoutMs)
    });

    if (response.status === 401 && canRefresh && attempt === 0) {
      await getAccessToken(true);
      return uploadFile(localPath, remotePath, attempt + 1, retriedFolder);
    }
    if (retryable(response.status) && attempt < maxAttempts - 1) {
      await sleep(parseRetryAfter(response, attempt));
      return uploadFile(localPath, remotePath, attempt + 1, retriedFolder);
    }

    const data = await parseBody(response);
    if (!response.ok) {
      if (!retriedFolder && /path\/not_found/.test(data.error_summary || "")) {
        await ensureFolder(remoteFolder);
        return uploadFile(localPath, remotePath, attempt, true);
      }
      throw new DropboxError(data.error_summary || `Dropbox upload failed (${response.status}).`, {
        status: response.status,
        summary: data.error_summary || "",
        body: data
      });
    }
    if (Number(data.size) !== stat.size) {
      throw new DropboxError(
        `Dropbox upload size mismatch: local ${stat.size} bytes, remote ${data.size} bytes.`
      );
    }
    return {
      ok: true,
      path: data.path_display || remotePath,
      fileId: data.id || "",
      size: Number(data.size),
      localPath
    };
  }

  async function folderExists(folderPath) {
    try {
      const meta = await apiRequest("files/get_metadata", { path: folderPath });
      return meta[".tag"] === "folder";
    } catch (error) {
      if (error instanceof DropboxError && error.status === 409) return false;
      throw error;
    }
  }

  // "/ClipSpike" falls back to a pre-rename "/ChatClip" or "/Highlight Desk" folder when only that exists.
  let legacyRoot;
  async function withLegacyRoot(folder) {
    const normalized = normalizeFolder(folder);
    const parts = normalized.split("/").filter(Boolean);
    if (!parts.length || parts[0].toLowerCase() !== APP_FOLDER.toLowerCase()) return normalized;
    if (legacyRoot === undefined) {
      try {
        legacyRoot = null;
        if (!(await folderExists(`/${parts[0]}`))) {
          for (const name of LEGACY_DRIVE_FOLDERS) {
            if (await folderExists(`/${name}`)) { legacyRoot = name; break; }
          }
        }
      } catch {
        return normalized;
      }
    }
    return legacyRoot ? joinDropboxPath(`/${legacyRoot}`, parts.slice(1).join("/")) : normalized;
  }

  async function uploadClip(localPath, { folder = settings.folder, channel = "" } = {}) {
    const remoteFolder = joinDropboxPath(await withLegacyRoot(folder), channel);
    const remotePath = joinDropboxPath(remoteFolder, path.basename(localPath));
    return uploadFile(localPath, remotePath);
  }

  return {
    provider: "dropbox",
    folder: normalizeFolder(settings.folder),
    getAccessToken,
    ensureFolder,
    uploadFile,
    uploadClip
  };
}

module.exports = {
  DropboxError,
  MAX_SIMPLE_UPLOAD,
  joinDropboxPath,
  asciiJson,
  createDropboxClient
};
