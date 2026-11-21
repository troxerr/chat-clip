#!/usr/bin/env node
"use strict";

// Long-running soak for the persistence layer: simulated clips are queued,
// uploaded, retried and recorded in history while a transient write failure is
// injected on a schedule. It reports memory growth so a leak or a lost entry
// shows up as a failure instead of a surprise on a streamer's machine.
//
//   node tools/soak.js --minutes 60            # default 10
//   node tools/soak.js --iterations 50000      # bounded, for CI
//
// This does NOT replace a 24 h live-capture soak of the whole recorder; run
// `npm start -- <channel>` for that and watch Activity Monitor.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createJobStore } = require("../lib/jobstore.js");

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? Number(process.argv[index + 1]) : fallback;
}

const minutes = arg("minutes", 10);
const maxIterations = arg("iterations", Infinity);
const deadline = Date.now() + minutes * 60_000;
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "clipspike-soak-"));
const store = createJobStore({ stateDir, maxHistory: 500 });
const canInjectFailure = typeof process.getuid === "function" && process.getuid() !== 0;

const rss = () => process.memoryUsage().rss / 1048576;
const startRss = rss();
let iterations = 0;
let completed = 0;
let injected = 0;
let failureOpen = false;

while (Date.now() < deadline && iterations < maxIterations) {
  const id = `clip-${iterations}`;
  // Every 997th iteration, break the disk for 5 operations, then heal it.
  if (canInjectFailure && iterations % 997 === 0 && iterations > 0 && !failureOpen) {
    fs.chmodSync(stateDir, 0o500);
    failureOpen = true;
    injected++;
  }
  if (failureOpen && iterations % 997 === 5) {
    fs.chmodSync(stateDir, 0o700);
    failureOpen = false;
  }

  store.enqueue({ id, status: "pending", attempts: 0 });
  store.update(id, { status: "uploading" });
  store.update(id, { status: "pending", attempts: 1, nextRetryAt: new Date(Date.now() - 1).toISOString() });
  store.due();
  store.remove(id);
  store.addHistory({ id, status: "uploaded" });
  completed++;
  iterations++;
}
if (failureOpen) fs.chmodSync(stateDir, 0o700);
store.listQueue(); // forces a final flush

const leftover = store.listQueue().length;
const history = store.listHistory().length;
const growth = rss() - startRss;
const summary = {
  iterations,
  completed,
  injectedWriteFailures: injected,
  queueLeftover: leftover,
  historyEntries: history,
  stillFailingToWrite: store.disabled,
  rssStartMb: Math.round(startRss),
  rssGrowthMb: Math.round(growth * 10) / 10
};
console.log(JSON.stringify(summary, null, 2));
fs.rmSync(stateDir, { recursive: true, force: true });

const problems = [];
if (leftover !== 0) problems.push(`${leftover} queue entries were lost or left behind`);
if (history !== Math.min(500, completed)) problems.push(`history holds ${history}, expected ${Math.min(500, completed)}`);
if (store.disabled) problems.push("persistence never recovered after injected failures");
if (growth > 150) problems.push(`memory grew ${growth.toFixed(0)} MB`);
if (problems.length) {
  console.error(`SOAK FAILED:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("SOAK OK");
