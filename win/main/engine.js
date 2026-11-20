"use strict";

// Runs the recorder (background.cjs) as a child process and turns its output
// into events. In the packaged app the child is Electron's own Node
// (process.execPath with ELECTRON_RUN_AS_NODE=1); in tests it is plain Node.

const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { parseSource } = require("../../lib/stream-source.js");

const STOP_GRACE_MS = 8000;
const STDERR_KEEP = 2000;

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
    stopGraceMs = STOP_GRACE_MS
  } = {}) {
    super();
    if (!script) throw new Error("Engine needs the path to background.cjs.");
    this.script = script;
    this.execPath = execPath;
    this.runAsNode = runAsNode;
    this.baseEnv = env;
    this.spawnImpl = spawnImpl;
    this.stopGraceMs = stopGraceMs;
    this.child = null;
    this.channel = "";
    this.stopping = false;
    this.stderrTail = "";
  }

  get running() { return Boolean(this.child); }

  start(input, extraEnv = {}) {
    if (this.child) throw new Error("A capture is already running.");
    const channel = channelFromInput(input);
    const env = { ...this.baseEnv, ...extraEnv, HIGHLIGHT_DESK_EVENTS: "1", HIGHLIGHT_DESK_COMMANDS: "1" };
    if (this.runAsNode) env.ELECTRON_RUN_AS_NODE = "1";
    const child = this.spawnImpl(this.execPath, [this.script, channel], { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.child = child;
    this.channel = channel;
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
      this.emit("exit", { code, signal, unexpected: !expected && code !== 0, detail });
    });
    return channel;
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
