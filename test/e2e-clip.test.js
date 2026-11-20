const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawn, spawnSync } = require("node:child_process");
const { videoEncoderArgs, resolveEncoder } = require("../lib/encoder.js");

// Full engine, no mocks: feeds a local video through the real recorder, asks
// for a highlight on stdin, and checks the vertical clip that comes out.
// Opt-in because it takes about a minute of real time (the recorder reads the
// input at playback speed). CI runs it with HIGHLIGHT_DESK_E2E=1; the Windows
// job runs it with only the bundled FFmpeg on PATH.
const enabled = process.env.HIGHLIGHT_DESK_E2E === "1";
const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

test("the engine turns a video into a 1080x1920 clip on request", { skip: !enabled || !hasFfmpeg, timeout: 180000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hd-e2e-"));
  const input = path.join(dir, "input.ts");
  let child;
  try {
    // 45 s of 16:9 test video with audio, in MPEG-TS like a live stream.
    // The input uses the machine's own H.264 encoder, so an LGPL FFmpeg works too.
    const made = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "45", ...videoEncoderArgs({ codec: resolveEncoder(), bitrate: "3M" }), "-pix_fmt", "yuv420p",
      "-g", "30", "-c:a", "aac", "-f", "mpegts", input
    ], { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8", timeout: 120000 });
    assert.equal(made.status, 0, `could not make the test video: ${made.stderr}`);

    const events = [];
    child = spawn(process.execPath, [path.join(__dirname, "..", "background.cjs"), "e2e_channel"], {
      env: { ...process.env, HIGHLIGHT_DESK_EVENTS: "1", HIGHLIGHT_DESK_COMMANDS: "1", HIGHLIGHT_DESK_KEYCHAIN: "0",
        HIGHLIGHT_DESK_INPUT: input, HIGHLIGHT_DESK_STATE: path.join(dir, "state"), HIGHLIGHT_DESK_OUTPUT: path.join(dir, "out"),
        HIGHLIGHT_DESK_CONFIG: path.join(dir, "config.json"), HIGHLIGHT_DESK_NOTIFICATIONS: "0" },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    const waiters = [];
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      events.push(event);
      for (const waiter of [...waiters]) if (waiter.match(event)) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(event); }
    });
    const next = (match, ms, label) => new Promise((resolve, reject) => {
      const past = events.find(match);
      if (past) return resolve(past);
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}\nlast events: ${events.slice(-6).map((e) => e.type + (e.message ? ": " + e.message : "")).join(" | ")}\nstderr: ${stderr}`)), ms);
      waiters.push({ match, resolve: (event) => { clearTimeout(timer); resolve(event); } });
    });
    const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));

    await next((e) => e.type === "ready", 30000, "ready");
    await next((e) => e.type === "status" && e.recording && e.mediaTime >= 6, 60000, "6 seconds of recorded video");
    child.stdin.write("save\n");
    await next((e) => e.type === "clip-requested", 20000, "clip-requested");
    const saved = await next((e) => e.type === "clip-saved" || e.type === "clip-failed", 120000, "the clip");
    assert.equal(saved.type, "clip-saved", `clip failed: ${saved.error}`);
    assert.ok(saved.path && fs.existsSync(saved.path), "clip file exists");
    assert.ok(saved.reframed, "the clip was reframed to 9:16");

    const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name", "-of", "csv=p=0", saved.path], { encoding: "utf8" });
    assert.equal(probe.status, 0, probe.stderr);
    const [codec, width, height] = probe.stdout.trim().split(",");
    assert.equal(`${width}x${height}`, "1080x1920");
    assert.equal(codec, "h264");
    assert.ok(fs.statSync(saved.path).size > 10000, "the clip has real video in it");

    child.stdin.write("stop\n");
    assert.equal(await Promise.race([exited, new Promise((r) => setTimeout(() => r("timeout"), 15000))]), 0, "clean exit");
  } finally {
    if (child && child.exitCode === null) child.kill("SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
