const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCredentialStore, saveSecrets } = require("../lib/credentials.js");
const { migrateConfig, CONFIG_SECRETS } = require("../tools/credentials.js");
const dropboxAuth = require("../tools/dropbox-auth.js");
const googleAuth = require("../tools/google-auth.js");
const { resolveLicenseKey } = require("../tools/license.js");
const appconfig = require("../lib/appconfig.js");

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "hd-wire-"));

// Fake DPAPI, bound to the credential name like the real entropy.
function fakeRun() {
  return (op, account, input) => {
    if (op === "protect") return Buffer.from(`ENC|${account}|${input}`).toString("base64");
    const [tag, boundTo, payload] = Buffer.from(input, "base64").toString().split("|");
    if (tag !== "ENC" || boundTo !== account) throw new Error("The data is invalid.");
    return payload;
  };
}
const winStore = (dir, extra = {}) =>
  createCredentialStore({ platform: "win32", env: {}, dir, run: fakeRun(), respectDisableFlag: false, ...extra });

test("saveSecrets stores what it can, skips empties, and never throws", () => {
  const dir = tempDir();
  try {
    const store = winStore(dir);
    const result = saveSecrets({ "dropbox.refresh": "r1", "dropbox.appSecret": "", "bad name": "x" }, { store });
    assert.deepEqual(result.stored, ["dropbox.refresh"]);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].name, "bad name");
    assert.equal(result.unsupported, false);
    assert.equal(store.get("dropbox.refresh"), "r1");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("saveSecrets reports unsupported where there is no writable store", () => {
  const mac = createCredentialStore({ platform: "darwin", env: {}, respectDisableFlag: false });
  assert.equal(saveSecrets({ "google.refresh": "x" }, { store: mac }).unsupported, true);
  const linux = createCredentialStore({ platform: "linux", env: {}, respectDisableFlag: false });
  assert.equal(saveSecrets({ "google.refresh": "x" }, { store: linux }).unsupported, true);
  const dir = tempDir();
  try {
    const off = createCredentialStore({ platform: "win32", env: { CHATCLIP_KEYCHAIN: "0" }, dir, run: fakeRun() });
    const result = saveSecrets({ "google.refresh": "x" }, { store: off });
    assert.equal(result.unsupported, true);
    assert.deepEqual(result.stored, []);
    assert.equal(fs.existsSync(path.join(dir, "credentials.json")), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("saveSecrets reports a failing store instead of throwing", () => {
  const dir = tempDir();
  try {
    const store = winStore(dir, { run: () => { throw new Error("Could not run PowerShell: ENOENT"); } });
    const result = saveSecrets({ "google.refresh": "x" }, { store });
    assert.deepEqual(result.stored, []);
    assert.match(result.failed[0].error, /PowerShell/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("Dropbox config keeps no second copy of a secret that was stored", () => {
  const fields = { appKey: "key", appSecret: "sec", refreshToken: "rt" };
  const both = dropboxAuth.mergeConfig({}, fields, ["dropbox.refresh", "dropbox.appSecret"]);
  assert.equal(both.dropbox.refreshToken, "");
  assert.equal(both.dropbox.appSecret, "");
  assert.equal(both.dropbox.appKey, "key", "the app key is not a secret");
  assert.equal(both.dropbox.enabled, true);
  const onlyRefresh = dropboxAuth.mergeConfig({}, fields, ["dropbox.refresh"]);
  assert.equal(onlyRefresh.dropbox.refreshToken, "");
  assert.equal(onlyRefresh.dropbox.appSecret, "sec", "a secret that failed to store stays in the config");
  const none = dropboxAuth.mergeConfig({ other: 1 }, fields);
  assert.equal(none.dropbox.refreshToken, "rt", "today's behavior when nothing was stored");
  assert.equal(none.other, 1);
});

test("Google config keeps no second copy of a secret that was stored", () => {
  const fields = { clientId: "id", clientSecret: "cs", refreshToken: "rt", email: "a@b.c" };
  const stored = googleAuth.mergeConfig({}, fields, ["google.refresh", "google.clientSecret"]);
  assert.equal(stored.googleDrive.refreshToken, "");
  assert.equal(stored.googleDrive.clientSecret, "");
  assert.equal(stored.googleDrive.clientId, "id");
  assert.equal(stored.storage.mode, "googleDrive");
  const partial = googleAuth.mergeConfig({}, fields, ["google.refresh"]);
  assert.equal(partial.googleDrive.clientSecret, "cs");
  assert.equal(googleAuth.mergeConfig({}, fields).googleDrive.refreshToken, "rt");
});

test("migrate moves secrets out of the config, keeps everything else, and is idempotent", () => {
  const dir = tempDir();
  try {
    const configPath = path.join(dir, "config.json");
    const original = {
      reframe: { blur: 33 },
      dropbox: { enabled: true, appKey: "k", appSecret: "ds", refreshToken: "dr", folder: "/x" },
      googleDrive: { clientId: "gid", clientSecret: "gs", refreshToken: "gr" },
      license: { key: "LIC-123", instance: "i-1", trialStartedAt: "2026-11-01" }
    };
    fs.writeFileSync(configPath, JSON.stringify(original));
    const store = winStore(dir);
    const first = migrateConfig(configPath, store);
    assert.deepEqual(first.moved.sort(), CONFIG_SECRETS.map((c) => c[2]).sort());
    assert.deepEqual(first.kept, []);
    const after = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(after.dropbox.refreshToken, "");
    assert.equal(after.googleDrive.clientSecret, "");
    assert.equal(after.license.key, "");
    assert.equal(after.dropbox.appKey, "k");
    assert.equal(after.reframe.blur, 33);
    assert.equal(after.license.trialStartedAt, "2026-11-01", "trial dates are not secrets");
    assert.equal(store.get("google.refresh"), "gr");
    assert.equal(store.get("license.key"), "LIC-123");
    assert.equal(fs.readFileSync(configPath, "utf8").includes("LIC-123"), false);
    const second = migrateConfig(configPath, store);
    assert.deepEqual([second.moved, second.kept], [[], []]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("migrate leaves a secret in the config when it cannot be stored", () => {
  const dir = tempDir();
  try {
    const configPath = path.join(dir, "config.json");
    fs.writeFileSync(configPath, JSON.stringify({ dropbox: { refreshToken: "dr" }, googleDrive: { refreshToken: "gr" } }));
    let calls = 0;
    const run = (op, account, input) => {
      calls += 1;
      if (account === "google.refresh") throw new Error("boom");
      return fakeRun()(op, account, input);
    };
    const result = migrateConfig(configPath, winStore(dir, { run }));
    assert.deepEqual(result.moved, ["dropbox.refresh"]);
    assert.equal(result.kept[0].name, "google.refresh");
    const after = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(after.dropbox.refreshToken, "");
    assert.equal(after.googleDrive.refreshToken, "gr", "not lost");
    assert.ok(calls >= 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("migrate does not rewrite a config that has no secrets, and refuses an unreadable one", () => {
  const dir = tempDir();
  try {
    const configPath = path.join(dir, "config.json");
    fs.writeFileSync(configPath, JSON.stringify({ reframe: { blur: 5 } }));
    const before = fs.statSync(configPath).mtimeMs;
    assert.deepEqual(migrateConfig(configPath, winStore(dir)).moved, []);
    assert.equal(fs.statSync(configPath).mtimeMs, before);
    fs.writeFileSync(configPath, "{not json");
    assert.throws(() => migrateConfig(configPath, winStore(dir)), /Could not read/);
    assert.equal(fs.readFileSync(configPath, "utf8"), "{not json", "an unreadable config is left untouched");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("license key: argument, then environment, then the store", () => {
  let reads = 0;
  const secret = () => { reads += 1; return "  FROM-STORE  "; };
  assert.equal(resolveLicenseKey({ "license-key": " ARG " }, { LEMON_LICENSE_KEY: "ENV" }, secret), "ARG");
  assert.equal(resolveLicenseKey({}, { LEMON_LICENSE_KEY: "ENV" }, secret), "ENV");
  assert.equal(reads, 0, "the store is not read when a key was supplied");
  assert.equal(resolveLicenseKey({}, {}, secret), "FROM-STORE");
  assert.equal(resolveLicenseKey({}, {}, () => ""), "");
});

// Windows only: the real DPAPI store, read back through the same functions the
// recorder uses, with an empty config. Runs in the Windows CI job.
test("tokens saved by the sign-in tools are read back by the recorder (real DPAPI)", { skip: process.platform !== "win32" }, () => {
  const dir = tempDir();
  const saved = { state: process.env.CHATCLIP_STATE, keychain: process.env.CHATCLIP_KEYCHAIN };
  process.env.CHATCLIP_STATE = dir;
  delete process.env.CHATCLIP_KEYCHAIN; // the test runner turns the store off; this test needs it
  try {
    const result = saveSecrets({ "dropbox.refresh": "rt-1", "dropbox.appSecret": "ds-1", "google.refresh": "gr-1", "google.clientSecret": "gs-1" });
    assert.deepEqual(result.failed, []);
    assert.equal(result.stored.length, 4);
    const blank = { dropbox: { refreshToken: "", appSecret: "" }, googleDrive: { refreshToken: "", clientSecret: "" } };
    const dropbox = appconfig.dropboxSettings(blank, process.env);
    assert.equal(dropbox.refreshToken, "rt-1");
    assert.equal(dropbox.appSecret, "ds-1");
    const google = appconfig.googleDriveSettings(blank, process.env);
    assert.equal(google.refreshToken, "gr-1");
    assert.equal(google.clientSecret, "gs-1");
    assert.equal(fs.readFileSync(path.join(dir, "credentials.json"), "utf8").includes("gr-1"), false);
  } finally {
    for (const [key, name] of [["state", "CHATCLIP_STATE"], ["keychain", "CHATCLIP_KEYCHAIN"]]) {
      if (saved[key] === undefined) delete process.env[name]; else process.env[name] = saved[key];
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
