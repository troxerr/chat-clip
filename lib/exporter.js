"use strict";

const fs = require("node:fs");
const { resolveEncoder, fallbackEncoder, videoEncoderArgs } = require("./encoder.js");
const { enqueueRender, cancelRenders } = require("./ffmpeg-queue.js");

function buildConcatInput(files) {
  return "concat:" + files.join("|");
}

function buildArgs({ files, inputFile, offset, duration, target, encoder, bitrate = "8M" }) {
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-nostdin",
    "-y",
    "-fflags", "+genpts",
    "-i", inputFile ?? buildConcatInput(files),
    "-ss", String(offset),
    "-t", String(duration),
    "-map", "0:v:0",
    "-map", "0:a?",
    ...videoEncoderArgs({ codec: encoder, bitrate }),
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "160k",
    "-movflags", "+faststart",
    "-f", "mp4",
    target
  ];
}

function exportClip({
  files,
  inputFile,
  offset,
  duration,
  target,
  ffmpegPath = "ffmpeg",
  encoder,
  bitrate = "8M",
  priority,
  timeoutMs = 120000
}) {
  if (!inputFile && (!Array.isArray(files) || !files.length)) {
    return Promise.resolve({ ok: false, error: "No input segments." });
  }
  if (!target) return Promise.resolve({ ok: false, error: "No output target." });
  if (!Number.isFinite(offset) || offset < 0) return Promise.resolve({ ok: false, error: "Invalid offset." });
  if (!Number.isFinite(duration) || duration <= 0) return Promise.resolve({ ok: false, error: "Invalid duration." });

  return enqueueRender({
    group: "export", ffmpegPath, target, priority, timeoutMs,
    async run(render) {
      const selected = !encoder || encoder === "auto" ? resolveEncoder({ ffmpegPath }) : encoder;
      const attempt = (codec) => render((draft) =>
        buildArgs({ files, inputFile, offset, duration, target: draft, encoder: codec, bitrate }));
      const result = await attempt(selected);
      const fallback = fallbackEncoder(selected, result.diagnostic);
      return fallback ? attempt(fallback) : result;
    }
  });
}

function sidecarPath(target) {
  return target.replace(/\.[^.\\/]+$/, "") + ".json";
}

function writeSidecar(target, metadata) {
  const file = sidecarPath(target);
  const draft = file + ".partial";
  fs.writeFileSync(draft, JSON.stringify(metadata, null, 2));
  fs.renameSync(draft, file);
  return file;
}

function killAll() {
  return cancelRenders("export");
}

module.exports = {
  buildConcatInput,
  buildArgs,
  exportClip,
  sidecarPath,
  writeSidecar,
  killAll
};
