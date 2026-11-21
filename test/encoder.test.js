const test = require("node:test");
const assert = require("node:assert/strict");
const { videoEncoderArgs, bitrateFor, normalizedEncoder, resolveEncoder, PROBE_ORDER, FALLBACK } = require("../lib/encoder.js");

test("default encoder is hardware H.264 without GPL libx264", () => {
  const args = videoEncoderArgs({ codec: "h264_videotoolbox", bitrate: "8M" });
  assert.deepEqual(args.slice(0, 2), ["-c:v", "h264_videotoolbox"]);
  assert.ok(args.includes("8M"));
  assert.ok(args.includes("-allow_sw"));
  assert.equal(args.includes("libx264"), false);
});

test("libx264 is available only as a development fallback", () => {
  const args = videoEncoderArgs({ codec: "libx264" });
  assert.deepEqual(args.slice(0, 2), ["-c:v", "libx264"]);
  assert.ok(args.includes("veryfast"));
});

test("bitrate scales with canvas size and stays bounded", () => {
  assert.equal(bitrateFor(1080, 1920), "7.5M");
  assert.equal(bitrateFor(640, 360), "4M");
  assert.equal(bitrateFor(3840, 2160), "16M");
});

test("unknown encoders fall back per platform", () => {
  assert.equal(normalizedEncoder("libx264"), "libx264");
  assert.equal(normalizedEncoder("nope", "darwin"), "h264_videotoolbox");
  assert.equal(normalizedEncoder("nope", "win32"), "auto");
  assert.equal(normalizedEncoder("h264_nvenc", "win32"), "h264_nvenc");
});

test("Windows hardware encoders build rate-controlled args", () => {
  for (const codec of ["h264_nvenc", "h264_qsv", "h264_amf", "h264_mf"]) {
    const args = videoEncoderArgs({ codec, bitrate: "6M" });
    assert.deepEqual(args.slice(0, 2), ["-c:v", codec]);
    assert.ok(args.includes("6M"));
  }
});

test("resolveEncoder picks the first encoder that really encodes", () => {
  const tried = [];
  const spawnImpl = (_bin, args) => {
    const codec = args[args.indexOf("-c:v") + 1];
    tried.push(codec);
    return { status: codec === "h264_amf" ? 0 : 1 };
  };
  assert.equal(resolveEncoder({ ffmpegPath: "ff-a", platform: "win32", spawnImpl }), "h264_amf");
  assert.deepEqual(tried, ["h264_nvenc", "h264_qsv", "h264_amf"]);
  // memoized: no further probing
  assert.equal(resolveEncoder({ ffmpegPath: "ff-a", platform: "win32", spawnImpl }), "h264_amf");
  assert.equal(tried.length, 3);
});

test("resolveEncoder falls back to h264_mf on Windows when nothing probes", () => {
  const spawnImpl = () => ({ status: 1 });
  assert.equal(resolveEncoder({ ffmpegPath: "ff-b", platform: "win32", spawnImpl }), "h264_mf");
});

test("libopenh264 builds a plain bitrate-controlled software encode", () => {
  assert.deepEqual(videoEncoderArgs({ codec: "libopenh264", bitrate: "5M" }), ["-c:v", "libopenh264", "-b:v", "5M"]);
  assert.equal(normalizedEncoder("libopenh264", "win32"), "libopenh264");
});

test("libopenh264 is the last thing probed on Windows and is used when it is all that works", () => {
  assert.equal(PROBE_ORDER.win32[PROBE_ORDER.win32.length - 1], "libopenh264");
  const tried = [];
  const spawnImpl = (_bin, args) => {
    const codec = args[args.indexOf("-c:v") + 1];
    tried.push(codec);
    return { status: codec === "libopenh264" ? 0 : 1 };
  };
  assert.equal(resolveEncoder({ ffmpegPath: "ff-openh264", platform: "win32", spawnImpl, env: {} }), "libopenh264");
  assert.deepEqual(tried, ["h264_nvenc", "h264_qsv", "h264_amf", "h264_mf", "libopenh264"]);
});

test("a PC where nothing probes still falls back to h264_mf, not the new last-resort encoder", () => {
  assert.equal(resolveEncoder({ ffmpegPath: "ff-none", platform: "win32", spawnImpl: () => ({ status: 1 }), env: {} }), "h264_mf");
  assert.equal(FALLBACK.win32, "h264_mf");
  assert.equal(resolveEncoder({ ffmpegPath: "ff-mac", platform: "darwin", spawnImpl: () => ({ status: 1 }), env: {} }), "h264_videotoolbox");
});

test("CLIPSPIKE_ENCODER forces a supported encoder without probing", () => {
  const spawnImpl = () => { throw new Error("must not probe when an encoder is forced"); };
  assert.equal(resolveEncoder({ ffmpegPath: "ff-forced", platform: "win32", spawnImpl, env: { CLIPSPIKE_ENCODER: "libopenh264" } }), "libopenh264");
  assert.equal(resolveEncoder({ ffmpegPath: "ff-forced", platform: "linux", spawnImpl, env: { CLIPSPIKE_ENCODER: "libx264" } }), "libx264");
});

test("an unsupported or 'auto' CLIPSPIKE_ENCODER is ignored", () => {
  const spawnImpl = () => ({ status: 0 });
  assert.equal(resolveEncoder({ ffmpegPath: "ff-bad", platform: "win32", spawnImpl, env: { CLIPSPIKE_ENCODER: "not_an_encoder" } }), "h264_nvenc");
  assert.equal(resolveEncoder({ ffmpegPath: "ff-auto", platform: "win32", spawnImpl, env: { CLIPSPIKE_ENCODER: "auto" } }), "h264_nvenc");
});
