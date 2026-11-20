"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MAX_REPORTS = 10;
const MAX_STACK_CHARS = 20000;

function describe(error) {
  if (error && typeof error === "object") {
    return { name: error.name || "Error", message: String(error.message || ""), stack: String(error.stack || "") };
  }
  return { name: "NonError", message: String(error), stack: "" };
}

// Persist a crash so it survives the process exiting (and the app window being
// gone). Never throws: a crash handler that crashes hides the original problem.
function writeCrashReport({ dir, kind = "uncaughtException", error, context = {}, now = new Date(), version = "" } = {}) {
  try {
    if (!dir) return null;
    const crashDir = path.join(dir, "crashes");
    fs.mkdirSync(crashDir, { recursive: true, mode: 0o700 });
    const detail = describe(error);
    const report = {
      time: now.toISOString(),
      kind,
      appVersion: version,
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      os: os.release(),
      uptimeSeconds: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      error: { ...detail, stack: detail.stack.slice(0, MAX_STACK_CHARS) },
      context
    };
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    const file = path.join(crashDir, `crash-${stamp}-${process.pid}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    prune(crashDir);
    return file;
  } catch {
    return null;
  }
}

function prune(crashDir, keep = MAX_REPORTS) {
  try {
    const files = fs.readdirSync(crashDir).filter((name) => /^crash-.*\.json$/.test(name)).sort();
    for (const name of files.slice(0, Math.max(0, files.length - keep))) {
      fs.rmSync(path.join(crashDir, name), { force: true });
    }
  } catch {}
}

function listCrashReports(dir) {
  try {
    return fs.readdirSync(path.join(dir, "crashes")).filter((name) => /^crash-.*\.json$/.test(name)).sort().reverse();
  } catch {
    return [];
  }
}

module.exports = { writeCrashReport, listCrashReports, MAX_REPORTS };
