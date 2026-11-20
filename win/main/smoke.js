"use strict";

// Scripted self-test of the real window, used by CI (HIGHLIGHT_DESK_SMOKE=<dir>).
// It feeds a local video and deterministic chat spike to the packaged recorder,
// verifies the automatic highlight, and writes screenshots and <dir>/result.json.
// Exit code 0 means every step passed.

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { app } = require("electron");

const runBinary = promisify(execFile);
const binDir = path.resolve(__dirname, "../../runtime/bin");

async function verifyClip(file) {
  const { stdout } = await runBinary(path.join(binDir, "ffprobe.exe"), [
    "-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", file
  ], { windowsHide: true, timeout: 15000 });
  const { streams, format } = JSON.parse(stdout);
  const video = streams.find((stream) => stream.codec_type === "video");
  const duration = Number(format?.duration);
  if (video?.width !== 1080 || video.height !== 1920 ||
      !streams.some((stream) => stream.codec_type === "audio") ||
      !Number.isFinite(duration) || duration < 28 || duration > 32) {
    throw new Error(`Expected a ~30-second 1080×1920 clip with audio. ffprobe: ${stdout}`);
  }
  await runBinary(path.join(binDir, "ffmpeg.exe"), [
    "-nostdin", "-v", "error", "-xerror", "-i", file, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"
  ], { windowsHide: true, timeout: 60000 });
  return { width: video.width, height: video.height, duration, audio: true };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, ms, label) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await sleep(500);
  }
}

async function run({ win, services, dir, send }) {
  const result = { steps: [], ok: false, node: process.versions.node, electron: process.versions.electron, execPath: process.execPath, dir };
  const relaunch = process.env.HIGHLIGHT_DESK_SMOKE_RELAUNCH === "1";
  const resultFile = path.join(dir, relaunch ? "relaunch.json" : "result.json");
  const shots = path.join(dir, "screenshots");
  fs.mkdirSync(shots, { recursive: true });
  const step = (name, detail) => { result.steps.push({ name, detail: detail || "" }); console.log(`[smoke] ${name}${detail ? `: ${detail}` : ""}`); };
  const shot = async (name) => {
    await sleep(400);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(shots, `${name}.png`), image.toPNG());
    step("screenshot", name);
  };
  const page = async (name) => { send("navigate", name); await sleep(300); };
  let finished = false;
  const watchdog = setTimeout(() => finish(new Error("overall time limit reached")), 240000);

  async function finish(error) {
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    if (error) { result.error = String(error.stack || error.message || error); console.error("[smoke] FAILED", result.error); }
    else result.ok = true;
    try { fs.writeFileSync(resultFile, JSON.stringify(result, null, 2)); } catch {}
    try { await services.core.shutdown(); } catch {}
    app.exit(result.ok ? 0 : 1);
  }

  try {
    await new Promise((resolve) => (win.webContents.isLoading() ? win.webContents.once("did-finish-load", resolve) : resolve()));
    step("window loaded", win.getTitle());
    if (Number(process.versions.node.split(".")[0]) < 22) throw new Error(`Node ${process.versions.node} is too old for the recorder (needs 22+)`);
    if (relaunch) {
      const previous = JSON.parse(fs.readFileSync(path.join(dir, "result.json"), "utf8"));
      if (!previous.ok || !previous.clip?.path) throw new Error("The first run did not save a clip.");
      const savedClip = services.core.clips.list().find((clip) => clip.localPath === previous.clip.path && clip.available);
      if (!savedClip) throw new Error("The saved clip is missing from the library after relaunch.");
      await page("clips");
      await waitFor(() => win.webContents.executeJavaScript(`
        Array.from(document.querySelectorAll('#page-clips .clip-actions button'))
          .some((button) => button.textContent === 'Open' && !button.disabled)
      `), 10000, "an openable clip in the relaunched window");
      result.clip = { path: savedClip.localPath, ...await verifyClip(savedClip.localPath) };
      step("saved clip listed and decoded after relaunch");
      await shot("clips-after-relaunch");
      await finish();
      return;
    }
    if (!process.env.HIGHLIGHT_DESK_INPUT || !fs.existsSync(process.env.HIGHLIGHT_DESK_INPUT)) throw new Error("HIGHLIGHT_DESK_INPUT must point at a test video");

    await shot("capture-idle");
    await page("clips"); await shot("clips-empty");
    await page("settings"); await shot("settings");
    await page("capture");

    await services.core.start("smoke_channel", { acknowledge: true });
    step("capture started");
    await waitFor(() => services.core.snapshot().capture.phase === "watching" && services.core.snapshot().capture.mediaTime >= 6, 90000, "6 seconds of recorded video");
    await shot("capture-watching");
    await page("settings");
    await win.webContents.executeJavaScript(`
      window.chatClipSmoke = {
        licenseHeading: document.querySelector("#license-card h2"),
        buffer: document.querySelector("#buffered-time").textContent
      };
      if (!window.chatClipSmoke.licenseHeading) throw new Error("License heading missing");
      true;
    `);
    await waitFor(() => win.webContents.executeJavaScript(
      'document.querySelector("#buffered-time").textContent !== window.chatClipSmoke.buffer'
    ), 10000, "a capture update in Settings");
    const settingsStable = await win.webContents.executeJavaScript(`
      window.chatClipSmoke.licenseHeading === document.querySelector("#license-card h2")
    `);
    if (!settingsStable) throw new Error("A capture update rebuilt the Settings license form");
    step("settings stayed mounted during capture");
    await page("capture");

    const clip = await waitFor(
      () => services.core.clips.list().find((item) => item.available && item.reason.startsWith("Chat spike")),
      120000, "the automatic chat-spike clip"
    );
    const media = await verifyClip(clip.localPath);
    result.clip = { path: clip.localPath, bytes: fs.statSync(clip.localPath).size, ...media };
    step("automatic clip decoded", `${media.width}×${media.height} · ${media.duration}s · audio`);

    await page("clips"); await shot("clips-with-clip");
    await page("capture");
    await services.core.stop();
    step("capture stopped");
    await finish();
  } catch (error) {
    try { await shot("failure"); } catch {}
    await finish(error);
  }
}

module.exports = { run };
