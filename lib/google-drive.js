"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { normalizeFolder } = require("./appconfig.js");

const { LEGACY_DRIVE_FOLDER } = require("./legacy.js");

const APP_FOLDER = "ChatClip";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const DEFAULT_API_BASE = "https://www.googleapis.com/drive/v3";
const DEFAULT_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
const DEFAULT_TOKEN_URL = "https://oauth2.googleapis.com/token";

class GoogleDriveError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "GoogleDriveError";
    this.status = details.status || 0;
    this.reason = details.reason || "";
    this.body = details.body || null;
  }
}

function escapeQuery(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function retryDelay(response, attempt) {
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

function errorDetails(data, status) {
  const error = data && data.error ? data.error : {};
  const first = Array.isArray(error.errors) && error.errors.length ? error.errors[0] : {};
  return {
    status,
    reason: first.reason || error.status || "",
    message: error.message || first.message || `Google Drive request failed (${status}).`,
    body: data
  };
}

function createGoogleDriveClient(settings, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("No fetch implementation is available.");
  const apiBase = (settings.apiBase || options.apiBase || DEFAULT_API_BASE).replace(/\/$/, "");
  const uploadBase = (settings.uploadBase || options.uploadBase || DEFAULT_UPLOAD_BASE).replace(/\/$/, "");
  const tokenUrl = settings.tokenUrl || options.tokenUrl || DEFAULT_TOKEN_URL;
  const now = options.now || Date.now;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxAttempts = Math.max(1, options.maxAttempts || 3);
  const uploadTimeoutMs = options.uploadTimeoutMs || 300000;
  const canRefresh = Boolean(settings.clientId && settings.clientSecret && settings.refreshToken);

  if (!settings.accessToken && !canRefresh) {
    throw new GoogleDriveError("Google Drive is not configured.");
  }

  let cachedToken = settings.accessToken || "";
  let expiresAt = settings.accessToken ? Infinity : 0;
  let refreshPromise = null;
  const folderCache = new Map();

  async function refreshAccessToken() {
    if (!canRefresh) throw new GoogleDriveError("Google Drive access token expired and no refresh token is configured.");
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const body = new URLSearchParams({
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        refresh_token: settings.refreshToken,
        grant_type: "refresh_token"
      });
      const response = await fetchImpl(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(30000)
      });
      const data = await parseBody(response);
      if (!response.ok || !data.access_token) {
        throw new GoogleDriveError(
          data.error_description || data.error || `Google token refresh failed (${response.status}).`,
          { status: response.status, body: data }
        );
      }
      cachedToken = data.access_token;
      const lifetime = Number(data.expires_in);
      expiresAt = now() + Math.max(60, (Number.isFinite(lifetime) ? lifetime : 3600) - 60) * 1000;
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
    throw new GoogleDriveError("Google Drive credentials are missing.");
  }

  function retryable(status) {
    return status === 429 || status >= 500;
  }

  async function requestJson(url, { method = "GET", body, attempt = 0 } = {}) {
    const token = await getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers["Content-Type"] = "application/json; charset=UTF-8";
    const response = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60000)
    });

    if (response.status === 401 && canRefresh && attempt === 0) {
      await getAccessToken(true);
      return requestJson(url, { method, body, attempt: attempt + 1 });
    }
    if (retryable(response.status) && attempt < maxAttempts - 1) {
      await sleep(retryDelay(response, attempt));
      return requestJson(url, { method, body, attempt: attempt + 1 });
    }

    const data = await parseBody(response);
    if (!response.ok) {
      const details = errorDetails(data, response.status);
      throw new GoogleDriveError(details.message, details);
    }
    return data;
  }

  async function findFolder(name, parentId) {
    const query = `name = '${escapeQuery(name)}' and mimeType = '${FOLDER_MIME}' and '${parentId}' in parents and trashed = false`;
    const fields = encodeURIComponent("files(id,name,webViewLink)");
    const url = `${apiBase}/files?q=${encodeURIComponent(query)}&spaces=drive&fields=${fields}&pageSize=10`;
    const data = await requestJson(url);
    return data.files && data.files.length ? data.files[0] : null;
  }

  async function createFolder(name, parentId) {
    const fields = encodeURIComponent("id,name,webViewLink");
    const data = await requestJson(`${apiBase}/files?fields=${fields}`, {
      method: "POST",
      body: {
        name,
        mimeType: FOLDER_MIME,
        parents: [parentId]
      }
    });
    return data;
  }

  async function ensureChild(parentId, parentPath, name, { legacyName = "" } = {}) {
    const cacheKey = `${parentId}/${name}`;
    if (folderCache.has(cacheKey)) return folderCache.get(cacheKey);
    let folder = await findFolder(name, parentId);
    let actualName = name;
    // A top-level folder from before the rename is reused instead of creating a second one.
    if (!folder && legacyName) {
      folder = await findFolder(legacyName, parentId);
      if (folder) actualName = legacyName;
    }
    if (!folder) folder = await createFolder(name, parentId);
    const result = {
      id: folder.id,
      path: `${parentPath === "/" ? "" : parentPath}/${actualName}`,
      webLink: folder.webViewLink || ""
    };
    folderCache.set(cacheKey, result);
    return result;
  }

  async function ensureFolderPath(folder) {
    const normalized = normalizeFolder(folder);
    if (normalized === "/") return { id: "root", path: "/", webLink: "" };
    let current = { id: "root", path: "/", webLink: "" };
    for (const part of normalized.split("/").filter(Boolean)) {
      const legacy = current.id === "root" && part === APP_FOLDER ? { legacyName: LEGACY_DRIVE_FOLDER } : {};
      current = await ensureChild(current.id, current.path, part, legacy);
    }
    return current;
  }

  async function ensureChannelFolder(folder, channel) {
    const root = await ensureFolderPath(folder);
    if (!channel) return root;
    return ensureChild(root.id, root.path, channel);
  }

  async function startResumableUpload(localPath, folderId) {
    const stat = fs.statSync(localPath);
    const contents = fs.readFileSync(localPath);
    const fields = encodeURIComponent("id,name,size,webViewLink");
    let lastError = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const token = await getAccessToken();
        const init = await fetchImpl(`${uploadBase}/files?uploadType=resumable&fields=${fields}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": "video/mp4",
            "X-Upload-Content-Length": String(stat.size)
          },
          body: JSON.stringify({ name: path.basename(localPath), parents: [folderId] }),
          signal: AbortSignal.timeout(30000)
        });
        if (init.status === 401 && canRefresh && attempt === 0) {
          await getAccessToken(true);
          continue;
        }
        if (retryable(init.status) && attempt < maxAttempts - 1) {
          await sleep(retryDelay(init, attempt));
          continue;
        }
        const initBody = await parseBody(init);
        if (!init.ok) {
          const details = errorDetails(initBody, init.status);
          throw new GoogleDriveError(details.message, details);
        }
        const location = init.headers && typeof init.headers.get === "function"
          ? (init.headers.get("location") || init.headers.get("Location"))
          : null;
        if (!location) throw new GoogleDriveError("Google Drive did not return a resumable upload URL.");

        const upload = await fetchImpl(location, {
          method: "PUT",
          headers: {
            "Content-Type": "video/mp4",
            "Content-Length": String(stat.size)
          },
          body: contents,
          signal: AbortSignal.timeout(uploadTimeoutMs)
        });
        if (retryable(upload.status) && attempt < maxAttempts - 1) {
          await sleep(retryDelay(upload, attempt));
          continue;
        }
        const data = await parseBody(upload);
        if (!upload.ok) {
          const details = errorDetails(data, upload.status);
          throw new GoogleDriveError(details.message, details);
        }
        if (Number(data.size) !== stat.size) {
          throw new GoogleDriveError(
            `Google Drive upload size mismatch: local ${stat.size} bytes, remote ${data.size} bytes.`
          );
        }
        return {
          ok: true,
          fileId: data.id || "",
          size: Number(data.size),
          webLink: data.webViewLink || "",
          bytes: stat.size
        };
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts - 1 && (!error.status || retryable(error.status))) {
          await sleep(Math.min(8000, 500 * 2 ** attempt));
          continue;
        }
        throw error;
      }
    }
    throw lastError || new GoogleDriveError("Google Drive upload failed.");
  }

  async function uploadClip(localPath, { folder = settings.folder, channel = "" } = {}) {
    if (!localPath || !fs.existsSync(localPath)) {
      throw new GoogleDriveError(`Input not found: ${localPath}`);
    }
    const targetFolder = await ensureChannelFolder(folder, channel);
    const uploaded = await startResumableUpload(localPath, targetFolder.id);
    const remotePath = `${targetFolder.path === "/" ? "" : targetFolder.path}/${path.basename(localPath)}`;
    return {
      ok: true,
      provider: "googleDrive",
      path: remotePath,
      remotePath,
      fileId: uploaded.fileId,
      size: uploaded.size,
      webLink: uploaded.webLink
    };
  }

  return {
    provider: "googleDrive",
    folder: normalizeFolder(settings.folder),
    getAccessToken,
    ensureFolderPath,
    ensureChannelFolder,
    uploadClip
  };
}

module.exports = {
  GoogleDriveError,
  FOLDER_MIME,
  createGoogleDriveClient
};
