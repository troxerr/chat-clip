"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MAX_BYTES = 256 * 1024;

// Only fixed event names and categories are persisted. Error messages from the
// OS, provider, and recorder may contain credentials, paths, or viewer data.
const EVENTS = new Set([
  "startup.begin", "startup.ready", "startup.failed", "renderer.load_failed",
  "renderer.exited", "license.activate", "license.validate", "license.deactivate",
  "capture.start", "capture.stop", "capture.save_highlight",
  "capture.clip_failed", "capture.error", "capture.fatal", "capture.exited"
]);

function errorCategory(error) {
  const message = typeof error === "string" ? error : String(error?.message || "");
  if (/activation limit/i.test(message)) return "activation_limit";
  if (/ETIMEDOUT|timed? out/i.test(message)) return "timeout";
  if (/could not reach the license service|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET/i.test(message)) return "connection";
  if (/revoked|expired|not valid/i.test(message)) return "invalid_or_expired";
  if (/DPAPI|PowerShell|encrypt|credential store/i.test(message)) return "credential_store";
  return "other";
}

function createDiagnostics(userData, maxBytes = MAX_BYTES) {
  const directory = path.join(userData, "logs");
  const file = path.join(directory, "clipspike.log");
  return function record(event, error) {
    if (!EVENTS.has(event)) return;
    try {
      const entry = JSON.stringify({
        time: new Date().toISOString(),
        event,
        ...(error != null && { category: errorCategory(error) })
      }) + "\n";
      fs.mkdirSync(directory, { recursive: true });
      if ((fs.statSync(file, { throwIfNoEntry: false })?.size || 0) + Buffer.byteLength(entry) > maxBytes) {
        fs.renameSync(file, path.join(directory, "clipspike.previous.log"));
      }
      fs.appendFileSync(file, entry);
    } catch {
      // An unavailable log must not prevent the app from starting or recording.
    }
  };
}

module.exports = { createDiagnostics };
