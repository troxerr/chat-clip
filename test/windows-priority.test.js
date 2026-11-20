const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { videoEncoderArgs, resolveEncoder } = require("../lib/encoder.js");
const { reframeClip, killAll } = require("../lib/reframe.js");

// Replaces the manual "open Task Manager" check: starts a real encode and asks
// Windows which priority class the FFmpeg process is in.
const onWindows = process.platform === "win32";
const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

function ownPriorityClass() {
  const script = `(Get-Process -Id ${process.pid}).PriorityClass`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 20000, windowsHide: true });
  return String(result.stdout || "").trim();
}

function priorityClassOf(token) {
  const script = `$p = Get-CimInstance Win32_Process -Filter "Name='ffmpeg.exe'" | Where-Object { $_.CommandLine -like '*${token}*' } | Select-Object -First 1; if ($p) { (Get-Process -Id $p.ProcessId).PriorityClass }`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 20000, windowsHide: true });
  return String(result.stdout || "").trim();
}

async function observe(input, level, dir) {
  const token = `prio-${level}-${process.pid}`;
  const job = reframeClip({ input, output: path.join(dir, `${token}.mp4`), encoder: resolveEncoder(), priority: level, timeoutMs: 120000 });
  let seen = "";
  const deadline = Date.now() + 60000;
  while (!seen && Date.now() < deadline) {
    seen = priorityClassOf(token);
    if (!seen) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  killAll(); // the answer is known; do not wait for the encode to finish
  await job;
  return seen;
}

test("encodes run at the priority class the setting asks for (real Windows process)", { skip: !onWindows || !hasFfmpeg, timeout: 300000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hd-prio-"));
  try {
    // A Windows child inherits a BelowNormal parent's priority class, and CI
    // runners can start the tests that way (the first run of this test saw an
    // encode that was never lowered report BelowNormal). Put this process at
    // Normal first, and insist on it, so the control below means something.
    os.setPriority(process.pid, os.constants.priority.PRIORITY_NORMAL);
    assert.equal(ownPriorityClass(), "Normal", "could not set the test process to Normal priority, so the check would prove nothing");

    const input = path.join(dir, "long.mp4");
    const made = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30", "-t", "40",
      ...videoEncoderArgs({ codec: resolveEncoder(), bitrate: "4M" }), "-pix_fmt", "yuv420p", input
    ], { encoding: "utf8", timeout: 200000, stdio: ["ignore", "ignore", "pipe"] });
    assert.equal(made.status, 0, `could not make the test video: ${made.stderr}`);

    assert.equal(await observe(input, "belowNormal", dir), "BelowNormal");
    // The control: proves the check can tell the two apart, so a pass above means something.
    assert.equal(await observe(input, "normal", dir), "Normal");
  } finally {
    killAll();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
