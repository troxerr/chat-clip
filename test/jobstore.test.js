const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createJobStore, defaultStateDir } = require("../lib/jobstore.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "chatclip-state-"));
}

test("queue and history round-trip through JSON files", () => {
  const dir = tempDir();
  try {
    const store = createJobStore({ stateDir: dir, maxHistory: 2 });
    assert.equal(fs.existsSync(store.queueFile), false);
    store.enqueue({ id: "a", provider: "dropbox", status: "pending", attempts: 0 });
    store.enqueue({ id: "b", provider: "googleDrive", status: "pending", attempts: 1 });
    assert.equal(store.listQueue().length, 2);
    assert.equal(store.due(0).length, 2);

    store.update("a", { status: "uploading" });
    assert.equal(store.due().length, 1);
    store.recover();
    assert.equal(store.listQueue().find((item) => item.id === "a").status, "pending");
    store.remove("a");
    assert.deepEqual(store.listQueue().map((item) => item.id), ["b"]);

    store.addHistory({ id: "one", status: "uploaded" });
    store.addHistory({ id: "two", status: "local" });
    store.addHistory({ id: "three", status: "uploaded" });
    assert.equal(store.listHistory().length, 2);
    store.addHistory({ id: "two", status: "uploaded" });
    assert.equal(store.listHistory().find((item) => item.id === "two").status, "uploaded");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("disabled state store keeps an in-memory queue", () => {
  const dir = tempDir();
  const file = path.join(dir, "not-a-directory");
  fs.writeFileSync(file, "x");
  try {
    const store = createJobStore({ stateDir: path.join(file, "state") });
    store.enqueue({ id: "memory", provider: "local", status: "pending" });
    assert.equal(store.disabled, true);
    assert.equal(store.listQueue().length, 1);
    store.remove("memory");
    assert.equal(store.listQueue().length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("defaultStateDir honors HIGHLIGHT_DESK_STATE", () => {
  assert.equal(defaultStateDir({ HIGHLIGHT_DESK_STATE: "/tmp/example" }), require("node:path").resolve("/tmp/example"));
});
