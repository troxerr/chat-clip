"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createDiagnostics } = require("../main/diagnostics.js");

test("diagnostics record known events without persisting raw error messages", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clipspike-logs-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const record = createDiagnostics(dir);
  record("startup.ready");
  record("license.activate", new Error("ETIMEDOUT secret-license-key"));
  record("capture.error", "secret-token in a stream URL");
  record("untrusted-event-with-secret");
  const raw = fs.readFileSync(path.join(dir, "logs", "clipspike.log"), "utf8");
  assert.doesNotMatch(raw, /secret|untrusted/);
  const entries = raw.trim().split("\n").map(JSON.parse);
  assert.deepEqual(entries.map(({ event, category }) => [event, category]), [
    ["startup.ready", undefined], ["license.activate", "timeout"], ["capture.error", "other"]
  ]);
});

test("diagnostics rotate at the size limit and tolerate a blocked log path", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clipspike-logs-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const record = createDiagnostics(dir, 100);
  record("startup.begin");
  record("startup.ready");
  record("capture.start");
  const logDir = path.join(dir, "logs");
  assert.match(fs.readFileSync(path.join(logDir, "clipspike.previous.log"), "utf8"), /startup.ready/);
  assert.match(fs.readFileSync(path.join(logDir, "clipspike.log"), "utf8"), /capture.start/);
  const blockedPath = path.join(dir, "file");
  fs.writeFileSync(blockedPath, "");
  assert.doesNotThrow(() => createDiagnostics(blockedPath)("startup.begin"));
});
