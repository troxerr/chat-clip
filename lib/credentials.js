"use strict";

// OAuth tokens and other secrets, kept out of the plain-text config file.
//
//   macOS    Keychain, read through /usr/bin/security (the app writes to it).
//   Windows  Windows DPAPI: each secret is encrypted with the signed-in user's
//            key (CurrentUser scope) through the built-in powershell.exe, and
//            the encrypted blob is saved in <state dir>/credentials.json. Other
//            Windows users and other machines cannot decrypt it. No native
//            module is needed, so the engine can read secrets synchronously.
//   other    No secret store; callers fall back to environment variables and
//            the config file.
//
// CLIPSPIKE_KEYCHAIN=0 turns the store off everywhere (development, CI).

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { stateDir } = require("./platform.js");
const { LEGACY_SERVICES, LEGACY_DPAPI_ENTROPIES, DPAPI_ENTROPY, withLegacyEnv } = require("./legacy.js");

const SERVICE = "com.clipspike.app.credentials";
// Names are case-sensitive and include camelCase ones such as dropbox.appSecret and kick.relayToken.
const ACCOUNT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const STORE_VERSION = 1;

// Secrets and blobs travel through powershell as base64 so that the console
// code page cannot change them. The secret itself goes over stdin, never the
// command line.
const DPAPI_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$entropy = [Text.Encoding]::UTF8.GetBytes($env:HD_ENTROPY + ':' + $env:HD_ACCOUNT)
$in = [Console]::In.ReadLine()
$bytes = [Convert]::FromBase64String($in)
if ($env:HD_OP -eq 'protect') {
  $out = [Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, 'CurrentUser')
} else {
  $out = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, 'CurrentUser')
}
[Console]::Out.Write([Convert]::ToBase64String($out))
`;

function powershellPath(env, platform) {
  if (platform !== "win32") return "powershell.exe";
  const root = env.SystemRoot || env.windir || "C:\\Windows";
  return path.win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

// Runs the DPAPI script. `run` is injectable so the store logic can be tested
// on any OS; the default talks to the real powershell.exe.
function dpapiRunner({ env = process.env, platform = process.platform, spawn = spawnSync } = {}) {
  const encoded = Buffer.from(DPAPI_SCRIPT, "utf16le").toString("base64");
  // `legacy` is an index into LEGACY_DPAPI_ENTROPIES (or false for the current entropy),
  // so blobs written before the renames can still be read.
  return function run(op, account, inputBase64, legacy = false) {
    const result = spawn(powershellPath(env, platform), [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded
    ], {
      input: inputBase64 + "\n",
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
      env: { ...process.env, HD_OP: op, HD_ACCOUNT: account, HD_ENTROPY: legacy === false ? DPAPI_ENTROPY : LEGACY_DPAPI_ENTROPIES[legacy] }
    });
    if (result.error) throw new Error(`Could not run PowerShell: ${result.error.message}`);
    if (result.status !== 0) throw new Error(String(result.stderr || "").trim().split("\n")[0] || `PowerShell exited with ${result.status}.`);
    return String(result.stdout || "").trim();
  };
}

function readStore(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed && parsed.version === STORE_VERSION && parsed.entries && typeof parsed.entries === "object") return parsed;
  } catch {}
  return { version: STORE_VERSION, entries: {} };
}

function writeStore(file, store) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const draft = `${file}.partial`;
  fs.writeFileSync(draft, JSON.stringify(store, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(draft, file);
}

function checkAccount(account) {
  if (!ACCOUNT.test(String(account || ""))) throw new Error(`Invalid credential name: ${account}`);
  return account;
}

function createCredentialStore({
  platform = process.platform,
  env = process.env,
  dir,
  run,
  security = spawnSync,
  respectDisableFlag = true,
  // Called once when a stored secret cannot be read, and again only after a read has worked in between.
  onReadError = null
} = {}) {
  const disabled = () => respectDisableFlag &&
    (withLegacyEnv(env).CLIPSPIKE_KEYCHAIN === "0" || withLegacyEnv(process.env).CLIPSPIKE_KEYCHAIN === "0");
  const file = () => path.join(dir || stateDir(env, platform), "credentials.json");
  const cache = new Map();
  const failing = new Set();
  const readFailed = (account, error) => {
    if (failing.has(account)) return;
    failing.add(account);
    try { if (onReadError) onReadError(account, error); } catch { /* reporting must never break a read */ }
  };
  let dpapi = run || null;
  const dpapiRun = () => (dpapi ||= dpapiRunner({ env, platform }));

  const backend = platform === "darwin" ? "keychain" : platform === "win32" ? "dpapi" : "none";
  const canWrite = backend === "dpapi";
  // Can this store accept a secret right now (right platform and not switched off)?
  const writable = () => canWrite && !disabled();

  function get(account) {
    if (disabled() || backend === "none" || !ACCOUNT.test(String(account || ""))) return "";
    try {
      if (backend === "keychain") {
        // Never cached: the app may re-save a token while the engine runs.
        // The service name changed with the rename; fall back to the old one until the app copies it over.
        for (const service of [SERVICE, ...LEGACY_SERVICES]) {
          const result = security("/usr/bin/security", ["find-generic-password", "-w", "-s", service, "-a", account],
            { encoding: "utf8", timeout: 5000 });
          if (result.status === 0) return String(result.stdout || "").trim();
        }
        return "";
      }
      const blob = readStore(file()).entries[account];
      if (!blob) { cache.delete(account); return ""; }
      // Decrypting spawns PowerShell, so reuse the result while the stored blob is unchanged.
      const hit = cache.get(account);
      if (hit && hit.blob === blob) return hit.value;
      const value = Buffer.from(unprotectAny(account, blob).plain, "base64").toString("utf8");
      cache.set(account, { blob, value });
      failing.delete(account);
      return value;
    } catch (error) {
      // A stored secret that cannot be read right now (slow or blocked PowerShell) is not the
      // same as no secret: callers can tell them apart with has(), and the failure is reported once.
      if (backend === "dpapi") readFailed(account, error);
      return "";
    }
  }

  function has(account) {
    if (disabled() || backend === "none" || !ACCOUNT.test(String(account || ""))) return false;
    if (backend === "dpapi") return Boolean(readStore(file()).entries[account]);
    return Boolean(get(account));
  }

  // Encrypt before an external operation, then persist only when it succeeds.
  function prepareSet(account, secret) {
    checkAccount(account);
    if (disabled()) throw new Error("The credential store is disabled (CLIPSPIKE_KEYCHAIN=0).");
    if (!canWrite) throw new Error(backend === "keychain"
      ? "On macOS, connect the account in the ClipSpike app; it saves tokens in Keychain."
      : "This platform has no credential store; use an environment variable instead.");
    const text = String(secret ?? "");
    if (!text) throw new Error("Refusing to store an empty secret.");
    const blob = dpapiRun()("protect", account, Buffer.from(text, "utf8").toString("base64"));
    if (!blob) throw new Error("Encryption returned nothing.");
    return () => {
      const store = readStore(file());
      store.entries[account] = blob;
      writeStore(file(), store);
      cache.set(account, { blob, value: text });
      return true;
    };
  }

  function set(account, secret) {
    return prepareSet(account, secret)();
  }

  function remove(account) {
    checkAccount(account);
    if (disabled() || !canWrite) return false;
    const store = readStore(file());
    const existed = account in store.entries;
    delete store.entries[account];
    if (existed) writeStore(file(), store);
    cache.delete(account);
    return existed;
  }

  function list() {
    return backend === "dpapi" && !disabled() ? Object.keys(readStore(file()).entries).sort() : [];
  }

  // Tries the current entropy, then each pre-rename one; reports which matched.
  function unprotectAny(account, blob) {
    let failure;
    for (const legacy of [false, ...LEGACY_DPAPI_ENTROPIES.keys()]) {
      try {
        return { plain: dpapiRun()("unprotect", account, blob, legacy), legacy };
      } catch (error) {
        failure ||= error;
      }
    }
    throw failure;
  }

  // Re-encrypts blobs written before the renames (old DPAPI entropy) under the new
  // entropy. Each result is decrypted again before it replaces the old blob, and
  // entries that fail stay untouched so the next launch can retry.
  function migrateLegacy() {
    const result = { migrated: [], failed: [] };
    if (backend !== "dpapi" || disabled()) return result;
    const store = readStore(file());
    let changed = false;
    for (const [account, blob] of Object.entries(store.entries)) {
      try {
        const { plain, legacy } = unprotectAny(account, blob);
        if (legacy === false) continue;
        const fresh = dpapiRun()("protect", account, plain);
        if (!fresh || dpapiRun()("unprotect", account, fresh) !== plain) throw new Error("verification failed");
        store.entries[account] = fresh;
        changed = true;
        result.migrated.push(account);
      } catch (error) {
        result.failed.push({ account, error: error.message });
      }
    }
    if (changed) writeStore(file(), store);
    cache.clear();
    return result;
  }

  return { backend, canWrite, writable, get, has, set, prepareSet, delete: remove, list, migrateLegacy };
}

let shared = null;
function defaultStore(env = process.env) {
  // The environment can change between calls in tests; rebuild when it does.
  if (!shared || shared.env !== env) shared = { env, store: createCredentialStore({ env }) };
  return shared.store;
}

function getSecret(account, { env = process.env } = {}) {
  return defaultStore(env).get(account);
}

// Saves several secrets without ever throwing, so a sign-in tool can fall back
// to the config file for anything that could not be stored and never lose a
// token. Empty values are skipped. `unsupported` means this platform or setting
// has no writable store (macOS, Linux, CLIPSPIKE_KEYCHAIN=0): nothing was
// attempted and the caller should keep its existing behavior.
function saveSecrets(entries, { store = defaultStore() } = {}) {
  const result = { stored: [], failed: [], unsupported: false };
  if (!store.writable()) {
    result.unsupported = true;
    return result;
  }
  for (const [name, value] of Object.entries(entries || {})) {
    if (!value) continue;
    try {
      store.set(name, value);
      result.stored.push(name);
    } catch (error) {
      result.failed.push({ name, error: error.message });
    }
  }
  return result;
}

module.exports = { SERVICE, ACCOUNT, DPAPI_SCRIPT, createCredentialStore, dpapiRunner, getSecret, saveSecrets };
