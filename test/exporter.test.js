const { videoEncoderArgs, resolveEncoder } = require("../lib/encoder.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildArgs, exportClip, sidecarPath, writeSidecar } = require("../lib/exporter.js");

const ffmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const ffprobe = spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

test("buildArgs maps optional audio and makes an MP4", () => {
  const args = buildArgs({ files: ["/tmp/a.ts", "/tmp/b.ts"], offset: 1.5, duration: 4, target: "/tmp/out.mp4" });
  const joined = args.join(" ");
  assert.match(joined, /-map 0:v:0/);
  assert.match(joined, /-map 0:a\?/);
  assert.match(joined, /-movflags \+faststart/);
  assert.equal(args.at(-1), "/tmp/out.mp4");
});

test("rejects invalid input", async () => {
  assert.equal((await exportClip({ files: [], target: "/tmp/x.mp4" })).ok, false);
  assert.equal((await exportClip({ files: ["/tmp/a.ts"], target: "" })).ok, false);
  assert.equal((await exportClip({ files: ["/tmp/a.ts"], offset: -1, duration: 2, target: "/tmp/x.mp4" })).ok, false);
});

test("sidecarPath replaces the media extension", () => {
  assert.equal(sidecarPath("/tmp/clip.mp4"), "/tmp/clip.json");
  assert.equal(sidecarPath("/tmp/clip.partial.mp4"), "/tmp/clip.partial.json");
});

test("exports a real MP4 and writes a sidecar", { skip: !ffmpeg || !ffprobe }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clipspike-export-"));
  const input = path.join(dir, "input.mp4");
  const target = path.join(dir, "clip.mp4");
  try {
    const generated = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=size=320x180:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=440",
      "-t", "6", ...videoEncoderArgs({ codec: resolveEncoder(), bitrate: "4M" }), "-pix_fmt", "yuv420p",
      "-c:a", "aac", input
    ], { stdio: "ignore", timeout: 60000 });
    assert.equal(generated.status, 0);

    const result = await exportClip({ files: [input], offset: 1, duration: 2.5, target });
    assert.equal(result.ok, true, result.error);
    assert.equal(fs.existsSync(target), true);
    assert.equal(fs.existsSync(target + ".partial"), false);

    const probed = spawnSync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", target
    ], { encoding: "utf8", timeout: 30000 });
    const duration = Number(probed.stdout.trim());
    assert.ok(duration >= 2 && duration <= 3.2, `unexpected duration ${duration}`);

    const sidecar = writeSidecar(target, { version: 1, reason: "test" });
    assert.equal(sidecar, path.join(dir, "clip.json"));
    assert.equal(JSON.parse(fs.readFileSync(sidecar, "utf8")).reason, "test");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("trims one existing MP4 without changing the source", { skip: !ffmpeg || !ffprobe }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clipspike-trim-"));
  const inputFile = path.join(__dirname, "..", "site", "media", "sample-highlight.mp4");
  const target = path.join(dir, "trimmed copy.mp4");
  try {
    const originalSize = fs.statSync(inputFile).size;
    const result = await exportClip({ inputFile, offset: 4, duration: 3, target, encoder: resolveEncoder() });
    assert.equal(result.ok, true, result.error);
    const probe = spawnSync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", target
    ], { encoding: "utf8", timeout: 15000 });
    assert.equal(probe.status, 0);
    assert.ok(Math.abs(Number(probe.stdout) - 3) <= 0.05);
    assert.equal(fs.statSync(inputFile).size, originalSize);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the FFmpeg queue rejects excess work and removes timed-out partial output", async () => {
  const { enqueueRender, cancelRenders } = require("../lib/ffmpeg-queue.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clipspike-render-queue-"));
  const submit = (number, script, timeoutMs) => enqueueRender({
    group: "test", ffmpegPath: process.execPath, target: path.join(dir, `${number}.mp4`), timeoutMs,
    run: (render) => render((draft) => ["-e", script, draft])
  });
  const write = `require("node:fs").writeFileSync(process.argv[1], "video");`;
  const target = path.join(dir, "0.mp4");
  const blocker = submit(0, write + "setInterval(() => {}, 1000)", 1200);
  const jobs = [submit(1, write, 5000), submit(2, write, 5000)];
  try {
    assert.match((await submit(0, write, 5000)).error, /already queued/);
    assert.match((await submit(3, write, 5000)).error, /queue is full/);
    assert.match((await blocker).error, /timed out/);
    assert.equal(fs.existsSync(target + ".partial"), false);
    assert.deepEqual((await Promise.all(jobs)).map((result) => result.ok), [true, true]);
  } finally {
    await cancelRenders("test");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
