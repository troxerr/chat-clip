const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createGoogleDriveClient, GoogleDriveError, FOLDER_MIME } = require("../lib/google-drive.js");

function response(body, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] ?? null;
      }
    },
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    }
  };
}

function tempFile(contents = "hello world") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chatclip-gdrive-"));
  const file = path.join(dir, "clip.mp4");
  fs.writeFileSync(file, contents);
  return { dir, file, size: Buffer.byteLength(contents) };
}

const SETTINGS = {
  enabled: true,
  configured: true,
  clientId: "client-id",
  clientSecret: "client-secret",
  refreshToken: "refresh-token",
  accessToken: "",
  folder: "/Highlight Desk"
};

test("requires Google Drive credentials", () => {
  assert.throws(
    () => createGoogleDriveClient({ ...SETTINGS, clientId: "", clientSecret: "", refreshToken: "", accessToken: "" }),
    GoogleDriveError
  );
});

test("refreshes a token, creates folders, and completes a resumable upload", async () => {
  const file = tempFile();
  const calls = { token: 0, lists: [], creates: [], init: 0, put: 0 };
  const fetchImpl = async (url, options = {}) => {
    if (url === "https://oauth2.googleapis.com/token") {
      calls.token += 1;
      return response({ access_token: "access", expires_in: 3600 });
    }
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?q=")) {
      const query = decodeURIComponent(new URL(url).searchParams.get("q") || "");
      calls.lists.push(query);
      return response({ files: [] });
    }
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?fields=")) {
      const body = JSON.parse(options.body);
      calls.creates.push(body);
      return response({
        id: body.parents[0] === "root" ? "folder-root" : "folder-channel",
        name: body.name,
        mimeType: FOLDER_MIME
      });
    }
    if (url.includes("uploadType=resumable")) {
      calls.init += 1;
      assert.equal(options.headers.Authorization, "Bearer access");
      assert.equal(options.headers["X-Upload-Content-Length"], String(file.size));
      return response({}, 200, { location: "https://upload.example/session/1" });
    }
    if (url === "https://upload.example/session/1") {
      calls.put += 1;
      assert.ok(Buffer.isBuffer(options.body));
      return response({ id: "file-1", name: "clip.mp4", size: file.size, webViewLink: "https://drive.example/file-1" });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const client = createGoogleDriveClient(SETTINGS, { fetchImpl, sleep: async () => {} });
  const result = await client.uploadClip(file.file, { folder: "/Highlight Desk", channel: "chan" });
  assert.equal(result.ok, true);
  assert.equal(result.provider, "googleDrive");
  assert.equal(result.remotePath, "/Highlight Desk/chan/clip.mp4");
  assert.equal(result.fileId, "file-1");
  assert.equal(result.size, file.size);
  assert.equal(result.webLink, "https://drive.example/file-1");
  assert.equal(calls.token, 1);
  assert.equal(calls.creates.length, 2);
  assert.equal(calls.creates[0].mimeType, FOLDER_MIME);
  assert.equal(calls.creates[0].parents[0], "root");
  assert.equal(calls.creates[1].parents[0], "folder-root");
  assert.equal(calls.init, 1);
  assert.equal(calls.put, 1);

  fs.rmSync(file.dir, { recursive: true, force: true });
});

test("uses an existing folder instead of creating it", async () => {
  const file = tempFile();
  let creates = 0;
  let lists = 0;
  const fetchImpl = async (url, options = {}) => {
    if (url === "https://oauth2.googleapis.com/token") return response({ access_token: "access", expires_in: 3600 });
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?q=")) {
      lists += 1;
      return lists === 1
        ? response({ files: [{ id: "existing-folder", name: "Chatclip" }] })
        : response({ files: [] });
    }
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?fields=")) {
      creates += 1;
      return response({ id: "new-channel", name: "chan" });
    }
    if (url.includes("uploadType=resumable")) return response({}, 200, { location: "https://upload.example/session/2" });
    if (url === "https://upload.example/session/2") {
      return response({ id: "file-2", size: file.size });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const client = createGoogleDriveClient(SETTINGS, { fetchImpl, sleep: async () => {} });
  const result = await client.uploadClip(file.file, { folder: "/Highlight Desk", channel: "chan" });
  assert.equal(result.ok, true);
  assert.equal(creates, 1);
  fs.rmSync(file.dir, { recursive: true, force: true });
});

test("rejects a size mismatch and preserves the local file", async () => {
  const file = tempFile();
  const fetchImpl = async (url, options = {}) => {
    if (url === "https://oauth2.googleapis.com/token") return response({ access_token: "access", expires_in: 3600 });
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?q=")) return response({ files: [] });
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?fields=")) return response({ id: "folder" });
    if (url.includes("uploadType=resumable")) return response({}, 200, { location: "https://upload.example/session/3" });
    if (url === "https://upload.example/session/3") return response({ id: "file", size: file.size + 1 });
    throw new Error(`unexpected URL ${url}`);
  };
  const client = createGoogleDriveClient(SETTINGS, { fetchImpl, sleep: async () => {} });
  await assert.rejects(
    () => client.uploadClip(file.file, { folder: "/Highlight Desk", channel: "chan" }),
    /size mismatch/
  );
  assert.equal(fs.existsSync(file.file), true);
  fs.rmSync(file.dir, { recursive: true, force: true });
});

test("surfaces quota errors without retrying", async () => {
  const file = tempFile();
  let uploadAttempts = 0;
  const fetchImpl = async (url) => {
    if (url === "https://oauth2.googleapis.com/token") return response({ access_token: "access", expires_in: 3600 });
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?q=")) return response({ files: [] });
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?fields=")) return response({ id: "folder" });
    if (url.includes("uploadType=resumable")) {
      uploadAttempts += 1;
      return response({ error: { message: "Storage quota exceeded", errors: [{ reason: "storageQuotaExceeded" }] } }, 403);
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const client = createGoogleDriveClient(SETTINGS, { fetchImpl, sleep: async () => {}, maxAttempts: 3 });
  await assert.rejects(
    () => client.uploadClip(file.file, { folder: "/Highlight Desk", channel: "chan" }),
    /Storage quota exceeded/
  );
  assert.equal(uploadAttempts, 1);
  fs.rmSync(file.dir, { recursive: true, force: true });
});

test("refreshes after a 401 response", async () => {
  const file = tempFile();
  let tokenCalls = 0;
  let listCalls = 0;
  const fetchImpl = async (url, options = {}) => {
    if (url === "https://oauth2.googleapis.com/token") {
      tokenCalls += 1;
      return response({ access_token: tokenCalls === 1 ? "old" : "new", expires_in: 3600 });
    }
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?q=")) {
      listCalls += 1;
      if (listCalls === 1) return response({ error: { message: "Invalid credentials" } }, 401);
      assert.equal(options.headers.Authorization, "Bearer new");
      return response({ files: [] });
    }
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?fields=")) return response({ id: "folder" });
    if (url.includes("uploadType=resumable")) return response({}, 200, { location: "https://upload.example/session/4" });
    if (url === "https://upload.example/session/4") return response({ id: "file-4", size: file.size });
    throw new Error(`unexpected URL ${url}`);
  };
  const client = createGoogleDriveClient(SETTINGS, { fetchImpl, sleep: async () => {} });
  const result = await client.uploadClip(file.file, { folder: "/Highlight Desk", channel: "chan" });
  assert.equal(result.ok, true);
  assert.equal(tokenCalls, 2);
  fs.rmSync(file.dir, { recursive: true, force: true });
});
