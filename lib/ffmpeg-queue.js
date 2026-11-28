"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { applyPriority } = require("./priority.js");

const MAX_WAITING = 2;
const waiting = [];
const targets = new Set();
let active = null;

function render({ ffmpegPath, target, draft, priority, timeoutMs, args, signal }) {
  let child;
  try {
    child = spawn(ffmpegPath, args(draft), { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  } catch (error) {
    return Promise.resolve({ ok: false, error: error.message });
  }
  applyPriority(child, priority);
  return new Promise((resolve) => {
    let stderr = "";
    let failure;
    const stop = (error) => {
      failure ||= error;
      try { child.kill("SIGKILL"); } catch {}
    };
    const abort = () => stop("FFmpeg render cancelled.");
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(() => stop(`FFmpeg timed out after ${Math.round(timeoutMs / 1000)}s.`), timeoutMs);
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-8000); });
    child.once("error", (error) => { failure ||= error.message; });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (failure) return resolve({ ok: false, error: failure });
      if (code !== 0) return resolve({ ok: false, error: stderr.trim() || `FFmpeg exited with code ${code}.`, diagnostic: stderr });
      try {
        const bytes = fs.statSync(draft).size;
        if (!bytes) throw new Error("FFmpeg produced an empty file.");
        fs.renameSync(draft, target);
        resolve({ ok: true, path: target, bytes });
      } catch (error) {
        resolve({ ok: false, error: error.message });
      }
    });
  });
}

async function runNext() {
  if (active || !waiting.length) return;
  const job = waiting.shift();
  active = job;
  const { target } = job;
  const draft = target + ".partial";
  let result;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    result = await job.run(async (args) => {
      if (job.controller.signal.aborted) return { ok: false, error: "FFmpeg render cancelled." };
      fs.rmSync(draft, { force: true });
      return render({ ...job, draft, args, signal: job.controller.signal });
    });
  } catch (error) {
    result = { ok: false, error: error.message };
  } finally {
    try { fs.rmSync(draft, { force: true }); } catch (error) {
      result = { ok: false, error: `Could not remove partial render: ${error.message}` };
    }
    targets.delete(job.key);
    active = null;
    job.resolve(result);
    void runNext();
  }
}

function enqueueRender(options) {
  const key = path.resolve(options.target);
  if (targets.has(key)) return Promise.resolve({ ok: false, error: "This output is already queued for rendering." });
  if (waiting.length >= MAX_WAITING) return Promise.resolve({ ok: false, error: "The FFmpeg render queue is full. Try again shortly." });
  targets.add(key);
  const job = { ...options, key, controller: new AbortController() };
  job.done = new Promise((resolve) => { job.resolve = resolve; });
  waiting.push(job);
  void runNext();
  return job.done;
}

function cancelRenders(group) {
  for (const job of waiting.filter((item) => item.group === group)) {
    waiting.splice(waiting.indexOf(job), 1);
    targets.delete(job.key);
    job.resolve({ ok: false, error: "FFmpeg render cancelled." });
  }
  if (active?.group !== group) return Promise.resolve();
  active.controller.abort();
  return active.done;
}

module.exports = { enqueueRender, cancelRenders };
