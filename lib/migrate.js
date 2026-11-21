"use strict";

// One-time, idempotent move of a "ChatClip" or "Highlight Desk" install to ClipSpike:
//   ~/.chatclip.json, then ~/.highlight-desk.json -> ~/.clipspike.json   (first found is copied; old files stay)
//   <state dir>/ChatClip, then <state dir>/Highlight Desk -> <state dir>/ClipSpike
//                                                    (renamed; merged if the target exists, newest wins)
//   Windows DPAPI credentials re-encrypted under the new entropy
// Nothing is deleted. A directory is only removed from its old name by an
// atomic rename; if that fails it is copied, verified, and the old one is left.
// macOS Keychain and preferences are migrated by the app itself (mac/HDMigration.m).

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { stateDir, legacyStateDirs } = require("./platform.js");
const { LEGACY_CONFIG_NAMES, withLegacyEnv } = require("./legacy.js");
const { createCredentialStore } = require("./credentials.js");

const MARKER = ".migrated-from-legacy";

function treeSizes(root, rel = "", out = {}) {
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const next = path.join(rel, entry.name);
    if (entry.isDirectory()) treeSizes(root, next, out);
    else out[next] = fs.statSync(path.join(root, next)).size;
  }
  return out;
}

function sameTree(a, b) {
  const left = treeSizes(a);
  const right = treeSizes(b);
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every((k) => left[k] === right[k]);
}

function relocate(from, to) {
  try {
    fs.renameSync(from, to);
    return "moved";
  } catch {
    fs.cpSync(from, to, { recursive: true, errorOnExist: true });
    const stat = fs.statSync(from);
    if (stat.isDirectory() ? !sameTree(from, to) : fs.statSync(to).size !== stat.size) {
      fs.rmSync(to, { recursive: true, force: true });
      throw new Error(`Copy of ${from} did not verify.`);
    }
    return "copied";
  }
}

function migrateStateDir(from, to) {
  if (!fs.existsSync(from)) return "none";
  if (path.resolve(from).toLowerCase() === path.resolve(to).toLowerCase()) return "none";
  if (!fs.existsSync(to)) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    return relocate(from, to);
  }
  let moved = 0;
  for (const name of fs.readdirSync(from)) {
    if (fs.existsSync(path.join(to, name))) continue;
    relocate(path.join(from, name), path.join(to, name));
    moved += 1;
  }
  return moved ? "merged" : "none";
}

function migrateConfigFile(from, to) {
  if (!fs.existsSync(from) || fs.existsSync(to)) return "none";
  const draft = `${to}.partial`;
  fs.copyFileSync(from, draft);
  fs.chmodSync(draft, 0o600);
  if (!fs.readFileSync(from).equals(fs.readFileSync(draft))) {
    fs.rmSync(draft, { force: true });
    throw new Error("Config copy did not verify.");
  }
  fs.renameSync(draft, to);
  return "copied";
}

function migrateLegacy({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  env = withLegacyEnv(env);
  const report = { config: "skipped", state: "skipped", credentials: "skipped", errors: [] };
  const attempt = (key, fn) => {
    try { report[key] = fn(); } catch (error) { report[key] = "failed"; report.errors.push(`${key}: ${error.message}`); }
  };
  const stateOverride = Boolean(env.CLIPSPIKE_STATE);
  if (env.CLIPSPIKE_CONFIG && stateOverride) return report;
  const target = stateDir(env, platform, home);
  const marker = path.join(target, MARKER);
  if (fs.existsSync(marker)) { report.state = "done"; return report; }

  if (!env.CLIPSPIKE_CONFIG) {
    attempt("config", () => {
      const to = path.join(home, ".clipspike.json");
      for (const name of LEGACY_CONFIG_NAMES) {
        const result = migrateConfigFile(path.join(home, name), to);
        if (result !== "none") return result;
      }
      return "none";
    });
  }
  if (!stateOverride) {
    attempt("state", () => {
      const results = legacyStateDirs(env, platform, home).map((from) => migrateStateDir(from, target));
      return results.find((r) => r !== "none") || "none";
    });
    if (platform === "win32") {
      attempt("credentials", () => {
        const result = createCredentialStore({ platform, env, dir: target }).migrateLegacy();
        if (result.failed.length) throw new Error(result.failed.map((f) => `${f.account}: ${f.error}`).join("; "));
        return result.migrated.length ? "reencrypted" : "none";
      });
    }
    if (!report.errors.length) {
      try {
        fs.mkdirSync(target, { recursive: true });
        fs.writeFileSync(marker, JSON.stringify({ migratedAt: new Date().toISOString(), from: ["ChatClip", "Highlight Desk"] }) + "\n");
      } catch (error) { report.errors.push(`marker: ${error.message}`); }
    }
  }
  return report;
}

// Entry-point helper: honor old env var names, migrate, and report problems on stderr.
function runMigration(options = {}) {
  require("./legacy.js").mirrorLegacyEnv(options.env || process.env);
  const report = migrateLegacy(options);
  for (const message of report.errors) console.error(`[migration] ${message}`);
  return report;
}

module.exports = { MARKER, runMigration, migrateLegacy, migrateStateDir, migrateConfigFile };
