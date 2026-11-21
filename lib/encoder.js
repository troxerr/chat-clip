"use strict";

const { spawnSync } = require("node:child_process");

const DEFAULT_BITRATE = "8M";
const HARDWARE = ["h264_nvenc", "h264_qsv", "h264_amf"];
// h264_mf is the Windows Media Foundation encoder; it is on every Windows PC
// except "N" editions without the Media Feature Pack. libopenh264 is a software
// encoder built into the bundled LGPL FFmpeg, so those PCs can still make clips.
const PROBE_ORDER = {
  win32: [...HARDWARE, "h264_mf", "libopenh264"],
  darwin: ["h264_videotoolbox"],
  linux: []
};
// What to return when no probe succeeds (the encode will then report the real error).
const FALLBACK = { win32: "h264_mf", darwin: "h264_videotoolbox" };
const SUPPORTED = new Set(["auto", "h264_videotoolbox", "h264_nvenc", "h264_qsv", "h264_amf", "h264_mf", "libopenh264", "libx264"]);

function bitrateFor(width = 1080, height = 1920) {
  const pixels = Math.max(1, Number(width) || 1080) * Math.max(1, Number(height) || 1920);
  const bits = Math.round(Math.min(16_000_000, Math.max(4_000_000, pixels * 30 * 0.12)));
  return `${Math.round(bits / 100000) / 10}M`;
}

function rateArgs(bitrate) {
  return ["-b:v", bitrate, "-maxrate", bitrate, "-bufsize", bitrate];
}

function videoEncoderArgs({ codec = process.env.CLIPSPIKE_ENCODER || "auto", bitrate = DEFAULT_BITRATE } = {}) {
  if (codec === "auto") codec = resolveEncoder();
  switch (codec) {
    case "libx264":
      return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"];
    case "h264_videotoolbox":
      return ["-c:v", "h264_videotoolbox", ...rateArgs(bitrate), "-allow_sw", "1"];
    case "h264_nvenc":
      return ["-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr", ...rateArgs(bitrate)];
    case "h264_qsv":
      return ["-c:v", "h264_qsv", ...rateArgs(bitrate)];
    case "h264_amf":
      return ["-c:v", "h264_amf", "-quality", "speed", "-rc", "vbr_peak", ...rateArgs(bitrate)];
    case "h264_mf":
      return ["-c:v", "h264_mf", "-b:v", bitrate];
    case "libopenh264":
      return ["-c:v", "libopenh264", "-b:v", bitrate];
    default:
      throw new Error(`Unsupported video encoder: ${codec}`);
  }
}

function normalizedEncoder(value, platform = process.platform) {
  if (SUPPORTED.has(value)) return value;
  return platform === "darwin" ? "h264_videotoolbox" : "auto";
}

// Try a one-second test encode. Hardware encoders are listed by ffmpeg even
// when the PC has no matching GPU, so only an actual encode proves one works.
function canEncode(ffmpegPath, codec, spawnImpl = spawnSync) {
  const args = [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=black:s=256x256:r=30:d=1",
    "-frames:v", "10",
    ...videoEncoderArgs({ codec, bitrate: "1M" }),
    "-pix_fmt", "yuv420p", "-f", "null", "-"
  ];
  try {
    const result = spawnImpl(ffmpegPath, args, { encoding: "utf8", timeout: 15000, windowsHide: true });
    return result.status === 0;
  } catch {
    return false;
  }
}

const resolved = new Map();

// CLIPSPIKE_ENCODER=<name> forces an encoder (development, and CI proving a
// specific one). Otherwise: the first encoder that really encodes on this
// machine, and if none does, FALLBACK so callers always get a name.
function resolveEncoder({ ffmpegPath = "ffmpeg", platform = process.platform, spawnImpl = spawnSync, order, refresh = false, env = process.env } = {}) {
  const forced = String(env.CLIPSPIKE_ENCODER || "");
  if (forced && forced !== "auto" && SUPPORTED.has(forced)) return forced;
  const list = order || PROBE_ORDER[platform] || [];
  const key = `${ffmpegPath}|${platform}|${list.join(",")}`;
  if (!refresh && resolved.has(key)) return resolved.get(key);
  let choice = null;
  for (const codec of list) {
    if (canEncode(ffmpegPath, codec, spawnImpl)) { choice = codec; break; }
  }
  if (!choice) choice = (!order && FALLBACK[platform]) || list[list.length - 1] || "libx264";
  resolved.set(key, choice);
  return choice;
}

module.exports = {
  DEFAULT_BITRATE,
  SUPPORTED,
  PROBE_ORDER,
  FALLBACK,
  bitrateFor,
  videoEncoderArgs,
  normalizedEncoder,
  canEncode,
  resolveEncoder
};
