"use strict";

const path = require("node:path");
const { Worker } = require("node:worker_threads");

// A stalled disk or evaluator must not block capture. Limit in-flight messages.
function startMonitor({ dir, channel, sessionId, settings, onStatus = () => {} }) {
  let worker;
  let pending = 0;
  let dropped = 0;
  let closed = false;
  let failed = false;
  try {
    worker = new Worker(path.join(__dirname, "monitor-worker.js"), { workerData: { dir, channel, sessionId, settings } });
    worker.on("message", message => {
      if (message.type === "ack") pending = Math.max(0, pending - 1);
      else { try { onStatus(message); } catch {} }
    });
    worker.on("error", error => { failed = true; try { onStatus({ type: "monitor-error", message: error.message }); } catch {} });
    worker.on("exit", code => { if (!closed && code) failed = true; });
    worker.unref();
  } catch (error) { failed = true; onStatus({ type: "monitor-error", message: error.message }); }
  return {
    record(record) {
      if (!worker || closed || failed) return false;
      if (pending >= 128) { dropped++; return false; }
      try { worker.postMessage({ type: "record", record, dropped }); pending++; return true; }
      catch { failed = true; return false; }
    },
    close() {
      if (!worker || closed) return Promise.resolve();
      closed = true;
      return new Promise(resolve => {
        const timer = setTimeout(() => { worker.terminate(); resolve(); }, 2500);
        worker.once("exit", () => { clearTimeout(timer); resolve(); });
        try { worker.postMessage({ type: "close", dropped }); } catch { clearTimeout(timer); resolve(); }
      });
    }
  };
}

module.exports = { startMonitor };
