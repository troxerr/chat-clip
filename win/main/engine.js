"use strict";

// Runs the recorder (background.cjs) as a child process and turns its output
// into events. In the packaged app the child is Electron's own Node
// (process.execPath with ELECTRON_RUN_AS_NODE=1); in tests it is plain Node.

const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { parseSource } = require("../../lib/stream-source.js");

// Long enough for the recorder to finish a highlight that is still exporting.
const STOP_GRACE_MS = 30000;
const STDERR_KEEP = 2000;
// An unexpected exit is retried a few times, with a growing wait. A recorder
// that dies right after starting is a setup problem (a missing tool), so it is
// reported instead of retried. A recorder that stayed up for a while starts
// the count again.
const RESTART_MAX = 3;
const RESTART_BASE_MS = 2000;
const MIN_UPTIME_MS = 10000;
const HEALTHY_UPTIME_MS = 60000;

// Turns what the user typed into a Twitch channel name, or throws an Error
// whose message can be shown as is.
function channelFromInput(input) {
  let source;
  try { source = parseSource(input); } catch (error) { throw new Error(error.message); }
  if (source.platform !== "twitch") throw new Error("This version records Twitch channels only.");
  return source.slug;
}

class Engine extends EventEmitter {
  constructor({
    script,
    execPath = process.execPath,
    runAsNode = false,
    env = process.env,
    spawnImpl = spawn,
    stopGraceMs = STOP_GRACE_MS,
    restartMax = RESTART_MAX,
    restartBaseMs = RESTART_BASE_MS,
    minUptimeMs = MIN_UPTIME_MS,
    healthyUptimeMs = HEALTHY_UPTIME_MS
  } = {}) {
    super();
    if (!script) throw new Error("Engine needs the path to background.cjs.");
    this.script = script;
    this.execPath = execPath;
    this.runAsNode = runAsNode;
    this.baseEnv = env;
    this.spawnImpl = spawnImpl;
    this.stopGraceMs = stopGraceMs;
    this.restartMax = restartMax;
    this.restartBaseMs = restartBaseMs;
    this.minUptimeMs = minUptimeMs;
    this.healthyUptimeMs = healthyUptimeMs;
    this.restartTimer = null;
    this.restartCount = 0;
    this.lastInput = "";
    this.lastExtraEnv = {};
    this.child = null;
    this.channel = "";
    this.stopping = false;
    this.stderrTail = "";
  }

  get running() { return Boolean(this.child) || Boolean(this.restartTimer); }

  start(input, extraEnv = {}) {
    if (this.running) throw new Error("A capture is already running.");
    this.restartCount = 0;
    this.lastInput = input;
    this.lastExtraEnv = extraEnv;
    return this.launch(input, extraEnv);
  }

  launch(input, extraEnv) {
    const channel = channelFromInput(input);
    const env = { ...this.baseEnv, ...extraEnv, CLIPSPIKE_EVENTS: "1", CLIPSPIKE_COMMANDS: "1" };
    if (this.runAsNode) env.ELECTRON_RUN_AS_NODE = "1";
    const child = this.spawnImpl(this.execPath, [this.script, channel], { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.child = child;
    this.channel = channel;
    this.startedAt = Date.now();
    this.stopping = false;
    this.stderrTail = "";

    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (event && typeof event.type === "string") this.emit("event", event);
    });
    child.stderr.on("data", (chunk) => { this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_KEEP); });
    // A closed pipe (the engine died while we wrote to it) must not crash the app.
    child.stdin.on("error", () => {});
    child.once("error", (error) => {
      if (this.child !== child) return;
      this.child = null;
      this.emit("exit", { code: null, unexpected: true, detail: `Could not start the recorder: ${error.message}` });
    });
    child.once("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      const expected = this.stopping;
      this.stopping = false;
      const lines = this.stderrTail.trim().split(/\r?\n/).filter(Boolean);
      const detail = expected ? "" : (lines[lines.length - 1] || `The recorder exited with ${signal ? `signal ${signal}` : `code ${code}`}.`);
      const unexpected = !expected && code !== 0;
      if (unexpected && this.scheduleRestart(detail)) return;
      this.emit("exit", { code, signal, unexpected, detail });
    });
    return channel;
  }

  // Relaunches after an unexpected exit. Returns false when it gives up, so the
  // caller reports the exit as final.
  scheduleRestart(detail) {
    const uptime = Date.now() - (this.startedAt || 0);
    if (uptime >= this.healthyUptimeMs) this.restartCount = 0;
    if (uptime < this.minUptimeMs || this.restartCount >= this.restartMax) return false;
    this.restartCount += 1;
    const attempt = this.restartCount;
    const delayMs = this.restartBaseMs * 2 ** (attempt - 1);
    this.emit("event", {
      type: "recorder-restarting", attempt, max: this.restartMax, delayMs,
      message: `The recorder stopped unexpectedly. Restarting it (attempt ${attempt} of ${this.restartMax}).`,
      detail
    });
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      try {
        this.launch(this.lastInput, this.lastExtraEnv);
      } catch (error) {
        this.emit("exit", { code: null, unexpected: true, detail: `Could not restart the recorder: ${error.message}` });
      }
    }, delayMs);
    return true;
  }

  send(command) {
    if (!this.child || !this.child.stdin.writable) return false;
    this.child.stdin.write(`${command}\n`);
    return true;
  }

  save() { return this.send("save"); }
  markMissed() { return this.send("missed"); }

  // Asks the recorder to finish cleanly, then forces it after a grace period.
  stop() {
    if (this.restartTimer) {
      // Waiting to relaunch: nothing is running, so cancelling is the stop.
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
      this.emit("exit", { code: 0, signal: null, unexpected: false, detail: "" });
      return Promise.resolve();
    }
    const child = this.child;
    if (!child) return Promise.resolve();
    this.stopping = true;
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); resolve(); };
      // A recorder that ignores "stop" (and a polite kill) is ended outright.
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, this.stopGraceMs);
      child.once("exit", done);
      child.once("error", done);
      this.send("stop");
    });
  }
}

module.exports = { Engine, channelFromInput, STOP_GRACE_MS };
