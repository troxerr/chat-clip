"use strict";

const { stateDir } = require("./platform.js");

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function defaultStateDir(env = process.env) {
  return stateDir(env);
}

// A corrupt state file is moved aside (not silently treated as empty and then
// overwritten) so the queue/history can still be inspected or recovered.
function quarantine(file) {
  try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch {}
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}
  quarantine(file);
  return fallback;
}

function writeJson(file, value) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const draft = `${file}.partial`;
  try {
    fs.writeFileSync(draft, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(draft, file);
  } catch (error) {
    // A full disk can leave a truncated draft behind; never leave it lying around.
    try { fs.rmSync(draft, { force: true }); } catch {}
    throw error;
  }
  try { fs.chmodSync(file, 0o600); } catch {}
}

function createJobStore({ stateDir = defaultStateDir(), maxHistory = 500 } = {}) {
  const queueFile = path.join(stateDir, "queue.json");
  const historyFile = path.join(stateDir, "history.json");
  // Persistence failures (disk full, volume unmounted, permissions) are often
  // transient, so they must not switch persistence off for the whole process.
  // The in-memory copy stays authoritative while a write is pending and is
  // flushed to disk on the next read or write that succeeds.
  let memoryQueue = [];
  let memoryHistory = [];
  let queueDirty = false;
  let historyDirty = false;
  let lastError = null;

  function tryWrite(file, value) {
    try {
      writeJson(file, value);
      return true;
    } catch (error) {
      lastError = error;
      return false;
    }
  }

  function loadQueue() {
    if (queueDirty) {
      if (tryWrite(queueFile, memoryQueue)) queueDirty = false;
      else return memoryQueue.slice();
    }
    try { fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 }); } catch (error) {
      lastError = error;
      return memoryQueue.slice();
    }
    const data = readJson(queueFile, []);
    return Array.isArray(data) ? data : [];
  }

  function saveQueue(queue) {
    memoryQueue = Array.isArray(queue) ? queue.slice() : [];
    queueDirty = !tryWrite(queueFile, memoryQueue);
    if (!queueDirty) lastError = historyDirty ? lastError : null;
  }

  function loadHistory() {
    if (historyDirty) {
      if (tryWrite(historyFile, memoryHistory)) historyDirty = false;
      else return memoryHistory.slice();
    }
    try { fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 }); } catch (error) {
      lastError = error;
      return memoryHistory.slice();
    }
    const data = readJson(historyFile, []);
    return Array.isArray(data) ? data : [];
  }

  function saveHistory(history) {
    memoryHistory = Array.isArray(history) ? history.slice(0, maxHistory) : [];
    historyDirty = !tryWrite(historyFile, memoryHistory);
    if (!historyDirty) lastError = queueDirty ? lastError : null;
  }

  function enqueue(item) {
    const queue = loadQueue();
    const index = queue.findIndex((entry) => entry.id === item.id);
    if (index >= 0) queue[index] = { ...queue[index], ...item };
    else queue.push(item);
    saveQueue(queue);
    return item;
  }

  function update(id, patch) {
    const queue = loadQueue();
    const index = queue.findIndex((entry) => entry.id === id);
    if (index < 0) return null;
    queue[index] = { ...queue[index], ...patch, updatedAt: new Date().toISOString() };
    saveQueue(queue);
    return queue[index];
  }

  function remove(id) {
    const queue = loadQueue().filter((entry) => entry.id !== id);
    saveQueue(queue);
  }

  function listQueue() {
    return loadQueue();
  }

  function due(now = Date.now()) {
    return loadQueue().filter((entry) => {
      if (entry.status === "uploading") return false;
      return !entry.nextRetryAt || Date.parse(entry.nextRetryAt) <= now;
    });
  }

  function recover() {
    const queue = loadQueue();
    let changed = false;
    for (const entry of queue) {
      if (entry.status === "uploading") {
        entry.status = "pending";
        entry.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) saveQueue(queue);
    return queue;
  }

  function addHistory(entry) {
    const history = loadHistory();
    const index = history.findIndex((item) => item.id === entry.id);
    if (index >= 0) history[index] = { ...history[index], ...entry };
    else history.unshift(entry);
    saveHistory(history.slice(0, maxHistory));
    return entry;
  }

  function listHistory() {
    return loadHistory();
  }

  function clearHistory() {
    saveHistory([]);
  }

  return {
    stateDir,
    queueFile,
    historyFile,
    // True while the latest state could not be written to disk (it self-heals).
    get disabled() { return queueDirty || historyDirty; },
    get lastError() { return lastError; },
    enqueue,
    update,
    remove,
    listQueue,
    due,
    recover,
    addHistory,
    listHistory,
    clearHistory
  };
}

module.exports = {
  defaultStateDir,
  createJobStore
};
