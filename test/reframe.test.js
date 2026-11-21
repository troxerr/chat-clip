const { videoEncoderArgs, resolveEncoder } = require("../lib/encoder.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { FACECAM_CORNERS, normalizeSplitOptions, buildSplitReframeFilter, buildReframeFilter, buildArgs, reframeClip } = require("../lib/reframe.js");

const ffmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const ffprobe = spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

test("buildReframeFilter creates a blurred 9:16 canvas with a centered foreground", () => {
  const filter = buildReframeFilter({ width: 1080, height: 1920, blur: 20 });
  assert.match(filter, /scale=540:960:force_original_aspect_ratio=increase/);
  assert.match(filter, /gblur=sigma=20:steps=5/);
  assert.match(filter, /scale=1080:1920:force_original_aspect_ratio=decrease/);
  assert.match(filter, /overlay=\(W-w\)\/2:\(H-h\)\/2/);
  assert.match(filter, /format=yuv420p/);
});

test("normalizeSplitOptions clamps ratios, aligns heights, and resolves corner presets", () => {
  const defaults = normalizeSplitOptions();
  assert.equal(defaults.camHeight, 672);
  assert.equal(defaults.gameHeight, 1248);
  assert.equal(defaults.camHeight % 2, 0);
  assert.equal(defaults.gameHeight % 2, 0);
  assert.deepEqual(defaults.facecam, FACECAM_CORNERS["bottom-left"]);
  assert.deepEqual(defaults.gameplay, { x: 0, y: 0, w: 1, h: 1 });

  const clamped = normalizeSplitOptions({
    width: 1080,
    height: 1920,
    camHeightRatio: 0.9,
    facecam: { x: 0.85, y: 0.85, w: 0.5, h: 0.5 }
  });
  assert.equal(clamped.camHeightRatio, 0.5);
  assert.equal(clamped.camHeight, 960);
  assert.equal(clamped.gameHeight, 960);
  assert.equal(clamped.facecam.w, 0.15);
  assert.equal(clamped.facecam.h, 0.15);
});

test("buildReframeFilter supports split-crop facecam + gameplay layout", () => {
  const filter = buildReframeFilter({
    width: 1080,
    height: 1920,
    layout: "split",
    facecamCorner: "top-right",
    camHeightRatio: 0.35
  });
  assert.match(filter, /\[0:v\]split=2\[cam_src\]\[game_src\]/);
  assert.match(filter, /crop=w=iw\*0\.25:h=ih\*0\.28:x=iw\*0\.735:y=ih\*0\.02/);
  assert.match(filter, /scale=1080:672:force_original_aspect_ratio=increase,crop=1080:672,setsar=1\[camout\]/);
  assert.match(filter, /\[game_src\]scale=1080:1248:force_original_aspect_ratio=increase,crop=1080:1248,setsar=1\[gameout\]/);
  assert.match(filter, /\[camout\]\[gameout\]vstack=inputs=2,format=yuv420p\[v\]/);

  const custom = buildSplitReframeFilter({
    width: 1080,
    height: 1920,
    facecam: { x: 0.05, y: 0.6, w: 0.2, h: 0.3 },
    gameplay: { x: 0.1, y: 0.05, w: 0.8, h: 0.9 },
    extraFilters: ["drawtext=text=TEST"]
  });
  assert.match(custom, /\[game_src\]crop=w=iw\*0\.8:h=ih\*0\.9:x=iw\*0\.1:y=ih\*0\.05,scale=1080:1248/);
  assert.match(custom, /vstack=inputs=2,drawtext=text=TEST,format=yuv420p\[v\]/);
});

test("buildArgs encodes an MP4 with optional audio", () => {
  const args = buildArgs({ input: "/tmp/in.mp4", output: "/tmp/out.mp4", width: 1080, height: 1920, blur: 20, crf: 20, preset: "veryfast" });
  const joined = args.join(" ");
  assert.match(joined, /-filter_complex/);
  assert.match(joined, /-map \[v\]/);
  assert.match(joined, /-map 0:a\?/);
  assert.match(joined, /-movflags \+faststart/);
  assert.equal(args.at(-1), "/tmp/out.mp4");

  const splitArgs = buildArgs({
    input: "/tmp/in.mp4",
    output: "/tmp/split.mp4",
    width: 1080,
    height: 1920,
    mode: "split",
    facecamCorner: "top-left"
  });
  assert.match(splitArgs.join(" "), /vstack=inputs=2/);
});

test("reframeClip reports missing input", async () => {
  const result = await reframeClip({ input: "/tmp/does-not-exist-clipspike.mp4", output: "/tmp/out.mp4" });
  assert.equal(result.ok, false);
  assert.match(result.error, /Input not found/);
});

test("reframes a landscape clip into a 1080x1920 MP4", { skip: !ffmpeg || !ffprobe }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clipspike-reframe-"));
  const input = path.join(dir, "input.mp4");
  const output = path.join(dir, "vertical.mp4");
  const splitOutput = path.join(dir, "vertical-split.mp4");
  try {
    const generated = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=440",
      "-t", "4", ...videoEncoderArgs({ codec: resolveEncoder(), bitrate: "4M" }), "-pix_fmt", "yuv420p",
      "-c:a", "aac", input
    ], { stdio: "ignore", timeout: 60000 });
    assert.equal(generated.status, 0);

    const result = await reframeClip({ input, output, width: 1080, height: 1920, crf: 24, preset: "ultrafast" });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.layout, "blur");
    assert.equal(fs.existsSync(output), true);
    assert.equal(fs.existsSync(output + ".partial"), false);

    const splitResult = await reframeClip({
      input,
      output: splitOutput,
      width: 1080,
      height: 1920,
      layout: "split",
      facecamCorner: "top-right",
      camHeightRatio: 0.35
    });
    assert.equal(splitResult.ok, true, splitResult.error);
    assert.equal(splitResult.layout, "split");
    assert.equal(fs.existsSync(splitOutput), true);

    for (const target of [output, splitOutput]) {
      const dimensions = spawnSync("ffprobe", [
        "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", target
      ], { encoding: "utf8", timeout: 30000 });
      assert.equal(dimensions.stdout.trim(), "1080x1920");

      const duration = spawnSync("ffprobe", [
        "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", target
      ], { encoding: "utf8", timeout: 30000 });
      const seconds = Number(duration.stdout.trim());
      assert.ok(seconds >= 3.5 && seconds <= 4.5, `unexpected duration ${seconds}`);

      const audio = spawnSync("ffprobe", [
        "-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=codec_name", "-of", "default=nw=1:nk=1", target
      ], { encoding: "utf8", timeout: 30000 });
      assert.equal(audio.stdout.trim(), "aac");
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
