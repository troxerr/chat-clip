const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createJobStore } = require("../lib/jobstore.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "chatclip-resilience-"));
}

function cleanup(dir) {
  try { fs.chmodSync(dir, 0o700); } catch {}
  fs.rmSync(dir, { recursive: true, force: true });
}

// Root ignores permission bits, so a read-only directory cannot simulate a failed write.
const canSimulateWriteFailure = typeof process.getuid === "function" && process.getuid() !== 0;

test("a corrupt queue file is quarantined instead of silently wiped", () => {
  const dir = tempDir();
  try {
    const store = createJobStore({ stateDir: dir });
    store.enqueue({ id: "keep-me", status: "pending" });
    fs.writeFileSync(store.queueFile, "{ not valid json");

    assert.deepEqual(store.listQueue(), []);
    const quarantined = fs.readdirSync(dir).filter((name) => name.startsWith("queue.json.corrupt-"));
    assert.equal(quarantined.length, 1, "corrupt file should be kept for recovery");
    assert.equal(fs.readFileSync(path.join(dir, quarantined[0]), "utf8"), "{ not valid json");

    store.enqueue({ id: "next", status: "pending" });
    assert.deepEqual(store.listQueue().map((item) => item.id), ["next"]);
  } finally {
    cleanup(dir);
  }
});

test("a queue file holding the wrong JSON type is treated as empty and quarantined", () => {
  const dir = tempDir();
  try {
    const store = createJobStore({ stateDir: dir });
    store.enqueue({ id: "a", status: "pending" });
    fs.writeFileSync(store.queueFile, "42");
    assert.deepEqual(store.listQueue(), []);
    assert.ok(fs.readdirSync(dir).some((name) => name.startsWith("queue.json.corrupt-")));
  } finally {
    cleanup(dir);
  }
});

test("a failed write keeps the newest state in memory and flushes it once the disk recovers", { skip: !canSimulateWriteFailure }, () => {
  const dir = tempDir();
  try {
    const store = createJobStore({ stateDir: dir });
    store.enqueue({ id: "one", status: "pending" });
    assert.equal(store.disabled, false);

    fs.chmodSync(dir, 0o500); // writes now fail, like a full or read-only volume
    store.enqueue({ id: "two", status: "pending" });
    assert.equal(store.disabled, true);
    assert.ok(store.lastError);
    // Reads must reflect the newest state, not the stale file on disk.
    assert.deepEqual(store.listQueue().map((item) => item.id), ["one", "two"]);
    assert.deepEqual(
      fs.readdirSync(dir).filter((name) => name.endsWith(".partial")),
      [],
      "no truncated draft may be left behind"
    );

    fs.chmodSync(dir, 0o700); // disk is back
    store.update("two", { status: "uploading" });
    assert.equal(store.disabled, false, "persistence must recover on its own");
    const onDisk = JSON.parse(fs.readFileSync(store.queueFile, "utf8"));
    assert.deepEqual(onDisk.map((item) => `${item.id}:${item.status}`), ["one:pending", "two:uploading"]);
  } finally {
    cleanup(dir);
  }
});

test("history survives a failed write and is not lost on the next read", { skip: !canSimulateWriteFailure }, () => {
  const dir = tempDir();
  try {
    const store = createJobStore({ stateDir: dir });
    store.addHistory({ id: "first", status: "uploaded" });
    fs.chmodSync(dir, 0o500);
    store.addHistory({ id: "second", status: "queued" });
    assert.deepEqual(store.listHistory().map((item) => item.id), ["second", "first"]);
    fs.chmodSync(dir, 0o700);
    assert.deepEqual(store.listHistory().map((item) => item.id), ["second", "first"]);
    assert.equal(store.disabled, false);
  } finally {
    cleanup(dir);
  }
});

test("an upload interrupted mid-flight is retried after a restart", () => {
  const dir = tempDir();
  try {
    const first = createJobStore({ stateDir: dir });
    first.enqueue({ id: "clip", status: "pending", attempts: 0 });
    first.update("clip", { status: "uploading" }); // process dies here (crash, sleep, power loss)

    const second = createJobStore({ stateDir: dir }); // fresh process, same state dir
    assert.equal(second.due().length, 0, "an in-flight entry is not due until recovered");
    second.recover();
    assert.deepEqual(second.due().map((item) => item.id), ["clip"]);
  } finally {
    cleanup(dir);
  }
});

test("retry backoff holds an entry back until its time arrives, including after sleep/wake", () => {
  const dir = tempDir();
  try {
    const store = createJobStore({ stateDir: dir });
    const wakeAt = Date.now() + 60_000;
    store.enqueue({ id: "later", status: "pending", nextRetryAt: new Date(wakeAt).toISOString() });
    assert.equal(store.due(Date.now()).length, 0);
    assert.equal(store.due(wakeAt + 1).length, 1, "a long sleep must make the entry due immediately on wake");
  } finally {
    cleanup(dir);
  }
});
