const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  DropboxError,
  createDropboxClient,
  joinDropboxPath,
  asciiJson
} = require("../lib/dropbox.js");

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

const SETTINGS = {
  enabled: true,
  configured: true,
  appKey: "key",
  appSecret: "secret",
  refreshToken: "refresh",
  accessToken: "",
  folder: "/ClipSpike",
  deleteAfterUpload: true
};

function tempFile(contents = "hello world") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clipspike-dropbox-"));
  const file = path.join(dir, "clip.mp4");
  fs.writeFileSync(file, contents);
  return { dir, file, size: Buffer.byteLength(contents) };
}

test("path helpers produce absolute Dropbox paths", () => {
  assert.equal(joinDropboxPath("/ClipSpike", "lacy", "clip.mp4"), "/ClipSpike/lacy/clip.mp4");
  assert.equal(joinDropboxPath("/", "lacy"), "/lacy");
  assert.equal(joinDropboxPath("ClipSpike", "", "clip.mp4"), "/ClipSpike/clip.mp4");
  assert.equal(joinDropboxPath("/"), "/");
});

test("asciiJson escapes non-ASCII header content", () => {
  const encoded = asciiJson({ path: "/ClipSpike/é" });
  assert.match(encoded, /^[\x00-\x7f]*$/);
  assert.equal(JSON.parse(encoded).path, "/ClipSpike/é");
});

test("requires credentials", () => {
  assert.throws(
    () => createDropboxClient({ ...SETTINGS, accessToken: "", refreshToken: "", appKey: "", appSecret: "" }),
    DropboxError
  );
});

test("refreshes a token, creates folders, and uploads a size-confirmed file", async () => {
  const file = tempFile();
  const calls = { token: 0, folders: [], uploads: 0 };
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith("/oauth2/token")) {
      calls.token += 1;
      assert.equal(options.method, "POST");
      return response({ access_token: "tok", expires_in: 3600 });
    }
    if (url.endsWith("/2/files/create_folder_v2")) {
      calls.folders.push(JSON.parse(options.body).path);
      return response({ metadata: {} });
    }
    if (url.endsWith("/2/files/upload")) {
      calls.uploads += 1;
      assert.equal(options.headers.Authorization, "Bearer tok");
      assert.ok(Buffer.isBuffer(options.body));
      const arg = JSON.parse(options.headers["Dropbox-API-Arg"]);
      assert.equal(arg.path, "/ClipSpike/chan/clip.mp4");
      assert.equal(arg.mode[".tag"], "add");
      assert.equal(arg.autorename, true);
      return response({ path_display: arg.path, id: "id-1", size: options.body.length });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const client = createDropboxClient(SETTINGS, { fetchImpl, sleep: async () => {} });
  const result = await client.uploadClip(file.file, { folder: "/ClipSpike", channel: "chan" });
  assert.equal(result.ok, true);
  assert.equal(result.path, "/ClipSpike/chan/clip.mp4");
  assert.equal(result.fileId, "id-1");
  assert.equal(result.verified, true);
  assert.equal(result.size, file.size);
  assert.equal(calls.token, 1);
  assert.deepEqual(calls.folders, ["/ClipSpike", "/ClipSpike/chan"]);
  assert.equal(calls.uploads, 1);

  fs.rmSync(file.dir, { recursive: true, force: true });
});

test("direct access tokens skip the refresh endpoint", async () => {
  const file = tempFile();
  let tokenCalls = 0;
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith("/oauth2/token")) {
      tokenCalls += 1;
      return response({ access_token: "unused" });
    }
    if (url.endsWith("/2/files/create_folder_v2")) return response({ metadata: {} });
    if (url.endsWith("/2/files/upload")) {
      assert.equal(options.headers.Authorization, "Bearer direct-token");
      return response({ path_display: "/ClipSpike/chan/clip.mp4", id: "id-2", size: file.size });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const client = createDropboxClient(
    { ...SETTINGS, accessToken: "direct-token", refreshToken: "", appKey: "", appSecret: "" },
    { fetchImpl, sleep: async () => {} }
  );
  const result = await client.uploadClip(file.file, { folder: "/ClipSpike", channel: "chan" });
  assert.equal(result.ok, true);
  assert.equal(tokenCalls, 0);
  fs.rmSync(file.dir, { recursive: true, force: true });
});

test("treats an existing folder as success", async () => {
  const file = tempFile();
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith("/oauth2/token")) return response({ access_token: "tok", expires_in: 3600 });
    if (url.endsWith("/2/files/create_folder_v2")) {
      return response({ error_summary: "path/conflict/folder/..." }, 409);
    }
    if (url.endsWith("/2/files/upload")) {
      const arg = JSON.parse(options.headers["Dropbox-API-Arg"]);
      return response({ path_display: arg.path, id: "id-3", size: options.body.length });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const client = createDropboxClient(SETTINGS, { fetchImpl, sleep: async () => {} });
  const result = await client.uploadClip(file.file, { folder: "/ClipSpike", channel: "chan" });
  assert.equal(result.ok, true);
  fs.rmSync(file.dir, { recursive: true, force: true });
});

test("rejects an upload whose remote size does not match", async () => {
  const file = tempFile();
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith("/oauth2/token")) return response({ access_token: "tok", expires_in: 3600 });
    if (url.endsWith("/2/files/create_folder_v2")) return response({ metadata: {} });
    if (url.endsWith("/2/files/upload")) {
      return response({ path_display: "/ClipSpike/chan/clip.mp4", id: "id-4", size: file.size + 1 });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const client = createDropboxClient(SETTINGS, { fetchImpl, sleep: async () => {} });
  await assert.rejects(
    () => client.uploadClip(file.file, { folder: "/ClipSpike", channel: "chan" }),
    /size mismatch/
  );
  fs.rmSync(file.dir, { recursive: true, force: true });
});

test("retries a 429 upload before failing", async () => {
  const file = tempFile();
  let uploads = 0;
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith("/oauth2/token")) return response({ access_token: "tok", expires_in: 3600 });
    if (url.endsWith("/2/files/create_folder_v2")) return response({ metadata: {} });
    if (url.endsWith("/2/files/upload")) {
      uploads += 1;
      if (uploads === 1) return response({ error_summary: "too_many_requests" }, 429, { "retry-after": "0" });
      const arg = JSON.parse(options.headers["Dropbox-API-Arg"]);
      return response({ path_display: arg.path, id: "id-5", size: options.body.length });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const client = createDropboxClient(SETTINGS, { fetchImpl, sleep: async () => {}, maxAttempts: 3 });
  const result = await client.uploadClip(file.file, { folder: "/ClipSpike", channel: "chan" });
  assert.equal(result.ok, true);
  assert.equal(uploads, 2);
  fs.rmSync(file.dir, { recursive: true, force: true });
});


test("refreshes a public PKCE token without a client secret", async () => {
  const file = tempFile();
  let tokenBody = null;
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith("/oauth2/token")) {
      tokenBody = options.body;
      return response({ access_token: "pkce-token", expires_in: 3600 });
    }
    if (url.endsWith("/2/files/create_folder_v2")) return response({ metadata: {} });
    if (url.endsWith("/2/files/upload")) {
      assert.equal(options.headers.Authorization, "Bearer pkce-token");
      return response({ path_display: "/ClipSpike/chan/clip.mp4", id: "pkce", size: options.body.length });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const client = createDropboxClient({ ...SETTINGS, appSecret: "" }, { fetchImpl, sleep: async () => {} });
  const result = await client.uploadClip(file.file, { folder: "/ClipSpike", channel: "chan" });
  assert.equal(result.ok, true);
  assert.equal(tokenBody.get("client_id"), SETTINGS.appKey);
  assert.equal(tokenBody.get("client_secret"), null);
  fs.rmSync(file.dir, { recursive: true, force: true });
});
