const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { writeCrashReport, listCrashReports, MAX_REPORTS } = require("../lib/crashlog.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "chatclip-crash-"));
}

test("writes a readable crash report with the stack and context", () => {
  const dir = tempDir();
  try {
    const file = writeCrashReport({ dir, error: new Error("boom"), context: { channel: "someone" }, version: "3.0.0" });
    assert.ok(file && fs.existsSync(file));
    const report = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(report.kind, "uncaughtException");
    assert.equal(report.error.message, "boom");
    assert.match(report.error.stack, /boom/);
    assert.equal(report.context.channel, "someone");
    assert.equal(report.appVersion, "3.0.0");
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("handles non-Error rejections", () => {
  const dir = tempDir();
  try {
    const file = writeCrashReport({ dir, kind: "unhandledRejection", error: "plain string" });
    const report = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(report.error.message, "plain string");
    assert.equal(report.kind, "unhandledRejection");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("keeps only the newest reports", () => {
  const dir = tempDir();
  try {
    for (let i = 0; i < MAX_REPORTS + 4; i++) {
      writeCrashReport({ dir, error: new Error(`e${i}`), now: new Date(Date.UTC(2026, 10, 1, 0, 0, i)) });
    }
    const names = listCrashReports(dir);
    assert.equal(names.length, MAX_REPORTS);
    const newest = JSON.parse(fs.readFileSync(path.join(dir, "crashes", names[0]), "utf8"));
    assert.equal(newest.error.message, `e${MAX_REPORTS + 3}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("never throws, even when the directory is unusable", () => {
  const dir = tempDir();
  const blocker = path.join(dir, "file");
  fs.writeFileSync(blocker, "x");
  try {
    assert.equal(writeCrashReport({ dir: path.join(blocker, "nested"), error: new Error("x") }), null);
    assert.equal(writeCrashReport({ error: new Error("no dir") }), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
