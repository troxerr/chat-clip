const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { migrateLegacy, MARKER } = require("../lib/migrate.js");
const { withLegacyEnv, mirrorLegacyEnv } = require("../lib/legacy.js");
const { createCredentialStore } = require("../lib/credentials.js");
const platform = require("../lib/platform.js");
const { createGoogleDriveClient } = require("../lib/google-drive.js");
const { createDropboxClient } = require("../lib/dropbox.js");

const tempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), "clipspike-migrate-"));
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

function legacyInstall(home) {
  write(path.join(home, ".highlight-desk.json"), '{"storage":{"mode":"dropbox","folder":"/Highlight Desk"}}');
  const state = path.join(home, "Library", "Application Support", "Highlight Desk");
  write(path.join(state, "history.json"), "[1,2,3]");
  write(path.join(state, "models", "model.bin"), "x".repeat(100));
  return state;
}

function chatClipInstall(home) {
  write(path.join(home, ".chatclip.json"), '{"storage":{"mode":"dropbox","folder":"/ChatClip"}}');
  const state = path.join(home, "Library", "Application Support", "ChatClip");
  write(path.join(state, "history.json"), "[chatclip]");
  write(path.join(state, "queue.json"), "{}");
  return state;
}

test("CHATCLIP_* and HIGHLIGHT_DESK_* names are honored; CLIPSPIKE_* wins, then CHATCLIP_*", () => {
  assert.equal(withLegacyEnv({ CHATCLIP_STATE: "/chat" }).CLIPSPIKE_STATE, "/chat");
  assert.equal(withLegacyEnv({ CHATCLIP_STATE: "/chat", HIGHLIGHT_DESK_STATE: "/hd" }).CLIPSPIKE_STATE, "/chat");
  assert.equal(withLegacyEnv({ CHATCLIP_STATE: "/chat", CLIPSPIKE_STATE: "/new" }).CLIPSPIKE_STATE, "/new");
  assert.equal(withLegacyEnv({ HIGHLIGHT_DESK_OUTPUT: "/hd" }).CLIPSPIKE_OUTPUT, "/hd");
});

test("a ChatClip install migrates to ClipSpike without deleting the old config", () => {
  const home = tempHome();
  try {
    const oldState = chatClipInstall(home);
    const report = migrateLegacy({ env: {}, platform: "darwin", home });
    assert.deepEqual(report.errors, []);
    const newState = path.join(home, "Library", "Application Support", "ClipSpike");
    assert.equal(fs.readFileSync(path.join(newState, "history.json"), "utf8"), "[chatclip]");
    assert.equal(fs.existsSync(oldState), false);
    assert.equal(fs.readFileSync(path.join(home, ".clipspike.json"), "utf8"), fs.readFileSync(path.join(home, ".chatclip.json"), "utf8"));
    assert.ok(fs.existsSync(path.join(home, ".chatclip.json")));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("with both a ChatClip and a Highlight Desk install, ChatClip wins and nothing is lost", () => {
  const home = tempHome();
  try {
    chatClipInstall(home);
    legacyInstall(home);
    const report = migrateLegacy({ env: {}, platform: "darwin", home });
    assert.deepEqual(report.errors, []);
    const newState = path.join(home, "Library", "Application Support", "ClipSpike");
    assert.equal(fs.readFileSync(path.join(newState, "history.json"), "utf8"), "[chatclip]");
    assert.equal(fs.existsSync(path.join(newState, "models", "model.bin")), true);
    assert.match(fs.readFileSync(path.join(home, ".clipspike.json"), "utf8"), /ChatClip/);
    assert.ok(fs.existsSync(path.join(home, ".highlight-desk.json")));
    assert.equal(migrateLegacy({ env: {}, platform: "darwin", home }).state, "done");
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("old env var names are honored, and new names win", () => {
  assert.equal(withLegacyEnv({ HIGHLIGHT_DESK_STATE: "/old" }).CLIPSPIKE_STATE, "/old");
  assert.equal(withLegacyEnv({ HIGHLIGHT_DESK_STATE: "/old", CLIPSPIKE_STATE: "/new" }).CLIPSPIKE_STATE, "/new");
  const env = { HIGHLIGHT_DESK_KICK_BROWSER: "/chrome" };
  mirrorLegacyEnv(env);
  assert.equal(env.CLIPSPIKE_KICK_BROWSER, "/chrome");
  assert.equal(platform.stateDir({ HIGHLIGHT_DESK_STATE: "/tmp/s" }, "darwin"), path.resolve("/tmp/s"));
});

test("config and state move to the new names, keep every file, and the old config stays", () => {
  const home = tempHome();
  try {
    const oldState = legacyInstall(home);
    const report = migrateLegacy({ env: {}, platform: "darwin", home });
    assert.deepEqual(report.errors, []);
    const newState = path.join(home, "Library", "Application Support", "ClipSpike");
    assert.equal(fs.readFileSync(path.join(newState, "history.json"), "utf8"), "[1,2,3]");
    assert.equal(fs.readFileSync(path.join(newState, "models", "model.bin"), "utf8").length, 100);
    assert.equal(fs.existsSync(oldState), false);
    assert.equal(fs.readFileSync(path.join(home, ".clipspike.json"), "utf8"), fs.readFileSync(path.join(home, ".highlight-desk.json"), "utf8"));
    assert.ok(fs.existsSync(path.join(newState, MARKER)));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("running the migration again changes nothing, even after the user edits or deletes new files", () => {
  const home = tempHome();
  try {
    legacyInstall(home);
    migrateLegacy({ env: {}, platform: "darwin", home });
    const config = path.join(home, ".clipspike.json");
    fs.rmSync(config);
    write(path.join(home, "Library", "Application Support", "Highlight Desk", "late.json"), "{}");
    const report = migrateLegacy({ env: {}, platform: "darwin", home });
    assert.equal(report.state, "done");
    assert.equal(fs.existsSync(config), false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("an existing new config or state folder is never overwritten", () => {
  const home = tempHome();
  try {
    legacyInstall(home);
    write(path.join(home, ".clipspike.json"), '{"mine":true}');
    const newState = path.join(home, "Library", "Application Support", "ClipSpike");
    write(path.join(newState, "history.json"), "[new]");
    const report = migrateLegacy({ env: {}, platform: "darwin", home });
    assert.equal(report.state, "merged");
    assert.equal(fs.readFileSync(path.join(home, ".clipspike.json"), "utf8"), '{"mine":true}');
    assert.equal(fs.readFileSync(path.join(newState, "history.json"), "utf8"), "[new]");
    assert.equal(fs.existsSync(path.join(newState, "models", "model.bin")), true);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("explicit config and state paths are left alone", () => {
  const home = tempHome();
  try {
    legacyInstall(home);
    const report = migrateLegacy({ env: { CLIPSPIKE_CONFIG: "/x/c.json", HIGHLIGHT_DESK_STATE: "/x/s" }, platform: "darwin", home });
    assert.equal(report.config, "skipped");
    assert.equal(fs.existsSync(path.join(home, ".clipspike.json")), false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("the output folder from before the rename is still used until a new one exists", () => {
  const home = tempHome();
  try {
    const legacy = path.join(home, "Movies", "Highlight Desk");
    fs.mkdirSync(legacy, { recursive: true });
    const same = (a, b) => assert.equal(path.normalize(a), path.normalize(b));
    same(platform.outputRoot({}, "darwin", home), legacy);
    const chatClip = path.join(home, "Movies", "ChatClip");
    fs.mkdirSync(chatClip);
    same(platform.outputRoot({}, "darwin", home), chatClip);
    fs.mkdirSync(path.join(home, "Movies", "ClipSpike"));
    same(platform.outputRoot({}, "darwin", home), path.join(home, "Movies", "ClipSpike"));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

// Fake DPAPI whose blobs are bound to account and entropy generation.
function fakeDpapi() {
  return (op, account, input, legacy = false) => {
    const gen = legacy === false ? "new" : `old${legacy}`;
    if (op === "protect") return Buffer.from(`${gen}|${account}|${input}`).toString("base64");
    const [g, a, payload] = Buffer.from(input, "base64").toString().split("|");
    if (g !== gen || a !== account) throw new Error("The data is invalid.");
    return payload;
  };
}

test("Windows credentials written under the old entropy are re-encrypted and still read", () => {
  const dir = tempHome();
  try {
    const run = fakeDpapi();
    const plain = Buffer.from("refresh-token").toString("base64");
    write(path.join(dir, "credentials.json"), JSON.stringify({ version: 1, entries: {
      "dropbox.refreshToken": run("protect", "dropbox.refreshToken", plain, 1)
    } }));
    const store = createCredentialStore({ platform: "win32", env: {}, dir, run, respectDisableFlag: false });
    assert.equal(store.get("dropbox.refreshToken"), "refresh-token");
    assert.deepEqual(store.migrateLegacy().migrated, ["dropbox.refreshToken"]);
    assert.deepEqual(store.migrateLegacy().migrated, []);
    const stored = JSON.parse(fs.readFileSync(path.join(dir, "credentials.json"), "utf8")).entries["dropbox.refreshToken"];
    assert.equal(run("unprotect", "dropbox.refreshToken", stored), plain);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("Windows credentials written under the ChatClip entropy are re-encrypted too", () => {
  const dir = tempHome();
  try {
    const run = fakeDpapi();
    const plain = Buffer.from("tok").toString("base64");
    write(path.join(dir, "credentials.json"), JSON.stringify({ version: 1, entries: { "kick.relayToken": run("protect", "kick.relayToken", plain, 0) } }));
    const store = createCredentialStore({ platform: "win32", env: {}, dir, run, respectDisableFlag: false });
    assert.equal(store.get("kick.relayToken"), "tok");
    assert.deepEqual(store.migrateLegacy().migrated, ["kick.relayToken"]);
    assert.deepEqual(store.migrateLegacy().migrated, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("macOS Keychain reads fall back to the old service names", () => {
  const seen = [];
  const security = (_cmd, args) => {
    const service = args[args.indexOf("-s") + 1];
    seen.push(service);
    return service === "com.highlightdesk.app.credentials" ? { status: 0, stdout: "tok\n" } : { status: 44, stdout: "" };
  };
  const store = createCredentialStore({ platform: "darwin", env: {}, security, respectDisableFlag: false });
  assert.equal(store.get("kick.relayToken"), "tok");
  assert.deepEqual(seen, ["com.clipspike.app.credentials", "com.chatclip.app.credentials", "com.highlightdesk.app.credentials"]);
});

const json = (body, status = 200, headers = {}) => ({
  ok: status < 400, status, headers: { get: (k) => headers[k.toLowerCase()] || null },
  text: async () => JSON.stringify(body), json: async () => body
});

test("Google Drive reuses an existing 'Highlight Desk' folder rather than creating ClipSpike", async () => {
  const dir = tempHome();
  const clip = path.join(dir, "clip.mp4");
  fs.writeFileSync(clip, "data");
  const created = [];
  const fetchImpl = async (url, options = {}) => {
    if (url.includes("oauth2")) return json({ access_token: "a", expires_in: 3600 });
    if (url.includes("/files?q=")) {
      const q = decodeURIComponent(url.split("q=")[1].split("&")[0]);
      return json({ files: q.includes("'Highlight Desk'") ? [{ id: "legacy-folder", name: "Highlight Desk" }] : [] });
    }
    if (url.includes("/files?fields=")) { created.push(JSON.parse(options.body).name); return json({ id: "chan" }); }
    if (url.includes("uploadType=resumable")) return json({}, 200, { location: "https://up/1" });
    if (url === "https://up/1") return json({ id: "f", size: 4 });
    throw new Error(`unexpected ${url}`);
  };
  try {
    const client = createGoogleDriveClient({ clientId: "i", clientSecret: "s", refreshToken: "r", folder: "/ClipSpike" }, { fetchImpl, sleep: async () => {} });
    const result = await client.uploadClip(clip, { folder: "/ClipSpike", channel: "chan" });
    assert.deepEqual(created, ["chan"]);
    assert.ok(result.path.startsWith("/Highlight Desk/chan/"));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("Dropbox uploads into an existing '/Highlight Desk' folder when '/ClipSpike' is missing", async () => {
  const dir = tempHome();
  const clip = path.join(dir, "clip.mp4");
  fs.writeFileSync(clip, "data");
  const uploadedTo = [];
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith("/oauth2/token")) return json({ access_token: "a", expires_in: 3600 });
    if (url.endsWith("files/get_metadata")) {
      const wanted = JSON.parse(options.body).path;
      return wanted === "/Highlight Desk" ? json({ ".tag": "folder" }) : json({ error_summary: "path/not_found/." }, 409);
    }
    if (url.endsWith("files/create_folder_v2")) return json({ error_summary: "path/conflict/folder/." }, 409);
    if (url.endsWith("files/upload")) {
      const arg = JSON.parse(options.headers["Dropbox-API-Arg"]);
      uploadedTo.push(arg.path);
      return json({ path_display: arg.path, id: "id", size: 4 });
    }
    throw new Error(`unexpected ${url}`);
  };
  try {
    const client = createDropboxClient({ appKey: "k", appSecret: "s", refreshToken: "r", folder: "/ClipSpike" }, { fetchImpl, sleep: async () => {} });
    await client.uploadClip(clip, { folder: "/ClipSpike", channel: "chan" });
    assert.deepEqual(uploadedTo, ["/Highlight Desk/chan/clip.mp4"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("Dropbox prefers an existing '/ChatClip' folder over '/Highlight Desk'", async () => {
  const dir = tempHome();
  const clip = path.join(dir, "clip.mp4");
  fs.writeFileSync(clip, "data");
  const uploadedTo = [];
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith("/oauth2/token")) return json({ access_token: "a", expires_in: 3600 });
    if (url.endsWith("files/get_metadata")) {
      const wanted = JSON.parse(options.body).path;
      return wanted === "/ChatClip" || wanted === "/Highlight Desk" ? json({ ".tag": "folder" }) : json({ error_summary: "path/not_found/." }, 409);
    }
    if (url.endsWith("files/create_folder_v2")) return json({ error_summary: "path/conflict/folder/." }, 409);
    if (url.endsWith("files/upload")) {
      const arg = JSON.parse(options.headers["Dropbox-API-Arg"]);
      uploadedTo.push(arg.path);
      return json({ path_display: arg.path, id: "id", size: 4 });
    }
    throw new Error(`unexpected ${url}`);
  };
  try {
    const client = createDropboxClient({ appKey: "k", appSecret: "s", refreshToken: "r", folder: "/ClipSpike" }, { fetchImpl, sleep: async () => {} });
    await client.uploadClip(clip, { folder: "/ClipSpike", channel: "chan" });
    assert.deepEqual(uploadedTo, ["/ChatClip/chan/clip.mp4"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
