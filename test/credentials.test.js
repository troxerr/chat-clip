const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCredentialStore } = require("../lib/credentials.js");
const cli = require("../tools/credentials.js");

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "hd-cred-"));

// Stand-in for the DPAPI script: reversible, and bound to the account name the
// way the real entropy is, so a blob copied to another name cannot be read.
function fakeRun() {
  const calls = [];
  const run = (op, account, input) => {
    calls.push(op);
    if (op === "protect") return Buffer.from(`ENC|${account}|${input}`).toString("base64");
    const [tag, boundTo, payload] = Buffer.from(input, "base64").toString().split("|");
    if (tag !== "ENC" || boundTo !== account) throw new Error("The data is invalid.");
    return payload;
  };
  return { run, calls };
}

const make = (extra = {}) => {
  const dir = tempDir();
  const fake = fakeRun();
  const store = createCredentialStore({ platform: "win32", env: {}, dir, run: fake.run, respectDisableFlag: false, ...extra });
  return { dir, store, ...fake };
};

test("a secret round-trips and is not stored in plain text", () => {
  const { dir, store } = make();
  try {
    assert.equal(store.backend, "dpapi");
    assert.equal(store.get("google.refresh"), "");
    assert.equal(store.set("google.refresh", "1//refresh-token-value"), true);
    assert.equal(store.get("google.refresh"), "1//refresh-token-value");
    assert.equal(store.has("google.refresh"), true);
    const onDisk = fs.readFileSync(path.join(dir, "credentials.json"), "utf8");
    assert.equal(onDisk.includes("refresh-token-value"), false);
    // a fresh store (a new process) reads the same file
    const again = createCredentialStore({ platform: "win32", env: {}, dir, run: fakeRun().run, respectDisableFlag: false });
    assert.equal(again.get("google.refresh"), "1//refresh-token-value");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("list, delete and has", () => {
  const { dir, store } = make();
  try {
    store.set("dropbox.refresh", "a");
    store.set("google.refresh", "b");
    assert.deepEqual(store.list(), ["dropbox.refresh", "google.refresh"]);
    assert.equal(store.delete("dropbox.refresh"), true);
    assert.equal(store.delete("dropbox.refresh"), false);
    assert.equal(store.has("dropbox.refresh"), false);
    assert.equal(store.get("dropbox.refresh"), "");
    assert.deepEqual(store.list(), ["google.refresh"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("invalid names and empty secrets are rejected", () => {
  const { dir, store } = make();
  try {
    for (const bad of ["", "Has Space", "../escape", "-leading", "a/b", "a".repeat(80)]) {
      assert.throws(() => store.set(bad, "x"), /Invalid credential name/);
      assert.equal(store.get(bad), "");
    }
    assert.throws(() => store.set("google.refresh", ""), /empty secret/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("every name the recorder reads is a valid credential name", () => {
  const { ACCOUNT } = require("../lib/credentials.js");
  for (const name of ["dropbox.refresh", "dropbox.appSecret", "google.refresh", "google.clientSecret", "kick.clientSecret", "kick.relayToken", "license.key"]) {
    assert.ok(ACCOUNT.test(name), `${name} must be accepted`);
  }
  const { dir, store } = make();
  try {
    store.set("dropbox.appSecret", "s1");
    store.set("dropbox.appsecret", "s2");
    assert.equal(store.get("dropbox.appSecret"), "s1", "names are case-sensitive");
    assert.equal(store.get("dropbox.appsecret"), "s2");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a blob copied to another name cannot be decrypted", () => {
  const { dir, store } = make();
  try {
    store.set("dropbox.refresh", "dropbox-secret");
    const file = path.join(dir, "credentials.json");
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    data.entries["google.refresh"] = data.entries["dropbox.refresh"];
    fs.writeFileSync(file, JSON.stringify(data));
    assert.equal(store.get("google.refresh"), "");
    assert.equal(store.get("dropbox.refresh"), "dropbox-secret");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a corrupt or foreign store file reads as empty and can be rewritten", () => {
  const { dir, store } = make();
  try {
    const file = path.join(dir, "credentials.json");
    fs.writeFileSync(file, "{not json");
    assert.equal(store.get("google.refresh"), "");
    assert.deepEqual(store.list(), []);
    fs.writeFileSync(file, JSON.stringify({ version: 99, entries: { "google.refresh": "x" } }));
    assert.equal(store.has("google.refresh"), false);
    store.set("google.refresh", "ok");
    assert.equal(store.get("google.refresh"), "ok");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a failing PowerShell never throws from get, and surfaces from set", () => {
  const { dir } = make();
  try {
    const store = createCredentialStore({ platform: "win32", env: {}, dir, respectDisableFlag: false,
      run: () => { throw new Error("Could not run PowerShell: ENOENT"); } });
    assert.throws(() => store.set("google.refresh", "x"), /PowerShell/);
    fs.writeFileSync(path.join(dir, "credentials.json"), JSON.stringify({ version: 1, entries: { "google.refresh": "AAAA" } }));
    assert.equal(store.get("google.refresh"), "");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("decrypted values are reused until the stored blob changes", () => {
  const { dir, store, calls } = make();
  try {
    store.set("google.refresh", "v1");
    const base = calls.length;
    store.get("google.refresh"); store.get("google.refresh");
    assert.equal(calls.length, base, "no decrypt while the blob is unchanged");
    // another process (the UI) saves a new token
    const other = createCredentialStore({ platform: "win32", env: {}, dir, run: fakeRun().run, respectDisableFlag: false });
    other.set("google.refresh", "v2");
    assert.equal(store.get("google.refresh"), "v2");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("CHATCLIP_KEYCHAIN=0 disables the store", () => {
  const { dir } = make();
  try {
    const fake = fakeRun();
    const on = createCredentialStore({ platform: "win32", env: {}, dir, run: fake.run, respectDisableFlag: false });
    on.set("google.refresh", "secret");
    const off = createCredentialStore({ platform: "win32", env: { CHATCLIP_KEYCHAIN: "0" }, dir, run: fake.run });
    assert.equal(off.get("google.refresh"), "");
    assert.equal(off.has("google.refresh"), false);
    assert.deepEqual(off.list(), []);
    assert.throws(() => off.set("google.refresh", "x"), /disabled/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("macOS reads Keychain through security, uncached, and cannot write from the engine", () => {
  const seen = [];
  const security = (bin, args) => { seen.push([bin, args]); return { status: 0, stdout: `token-${seen.length}\n` }; };
  const store = createCredentialStore({ platform: "darwin", env: {}, security, respectDisableFlag: false });
  assert.equal(store.backend, "keychain");
  assert.equal(store.get("google.refresh"), "token-1");
  assert.equal(store.get("google.refresh"), "token-2");
  assert.deepEqual(seen[0], ["/usr/bin/security", ["find-generic-password", "-w", "-s", "com.chatclip.app.credentials", "-a", "google.refresh"]]);
  assert.throws(() => store.set("google.refresh", "x"), /macOS/);
});

test("platforms without a store return nothing", () => {
  const store = createCredentialStore({ platform: "linux", env: {}, respectDisableFlag: false });
  assert.equal(store.backend, "none");
  assert.equal(store.get("google.refresh"), "");
  assert.throws(() => store.set("google.refresh", "x"), /no credential store/);
});

test("credentials CLI: has, delete, list, and refusal without a store", async () => {
  const { dir, store } = make();
  const log = console.log;
  const lines = [];
  console.log = (line) => lines.push(line);
  try {
    store.set("google.refresh", "x");
    assert.equal(await cli.main(["has", "google.refresh"], store), 0);
    assert.equal(await cli.main(["has", "nope"], store), 1);
    assert.equal(await cli.main(["list"], store), 0);
    assert.deepEqual(lines, ["google.refresh"]);
    assert.equal(await cli.main(["delete", "google.refresh"], store), 0);
    assert.equal(await cli.main(["bogus"], store), 2);
    const none = createCredentialStore({ platform: "linux", env: {}, respectDisableFlag: false });
    const error = console.error; console.error = () => {};
    assert.equal(await cli.main(["set", "x"], none), 2);
    console.error = error;
  } finally { console.log = log; fs.rmSync(dir, { recursive: true, force: true }); }
});

// Runs only on Windows, where the Windows CI job exercises the real DPAPI path.
test("real Windows DPAPI round trip, including Unicode and name binding", { skip: process.platform !== "win32" }, () => {
  const dir = tempDir();
  try {
    const store = createCredentialStore({ dir, respectDisableFlag: false });
    const secret = "tökén-✓-1//abc";
    store.set("google.refresh", secret);
    store.set("dropbox.refresh", "other");
    assert.equal(fs.readFileSync(path.join(dir, "credentials.json"), "utf8").includes("abc"), false);
    const fresh = createCredentialStore({ dir, respectDisableFlag: false });
    assert.equal(fresh.get("google.refresh"), secret);
    const file = path.join(dir, "credentials.json");
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    data.entries["dropbox.refresh"] = data.entries["google.refresh"];
    fs.writeFileSync(file, JSON.stringify(data));
    assert.equal(createCredentialStore({ dir, respectDisableFlag: false }).get("dropbox.refresh"), "");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
