"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { videoEncoderArgs } = require("./encoder.js");
const { applyPriority } = require("./priority.js");

const activeChildren = new Set();

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

  const draft = target + ".partial";
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.rmSync(draft, { force: true });
  } catch (error) {
    return Promise.resolve({ ok: false, error: error.message });
  }

  return new Promise((resolve) => {
    let settled = false;
    let stderr = "";
    let timer = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (!result.ok) {
        try { fs.rmSync(draft, { force: true }); } catch {}
      }
      resolve(result);
    };

    let child;
    try {
      child = spawn(ffmpegPath, buildArgs({ files, inputFile, offset, duration, target: draft, encoder, bitrate }), {
        stdio: ["ignore", "ignore", "pipe"]
      });
    } catch (error) {
      finish({ ok: false, error: error.message });
      return;
    }

    applyPriority(child, priority);
    activeChildren.add(child);
    timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      finish({ ok: false, error: `FFmpeg timed out after ${Math.round(timeoutMs / 1000)}s.` });
    }, timeoutMs);

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });

    child.on("error", (error) => {
      activeChildren.delete(child);
      finish({ ok: false, error: error.message });
    });

    child.on("close", (code) => {
      activeChildren.delete(child);
      if (settled) return;
      let size = 0;
      try { size = fs.statSync(draft).size; } catch {}
      if (code !== 0 || size <= 0) {
        finish({ ok: false, error: stderr.trim() || `FFmpeg exited with code ${code}.` });
        return;
      }
      try {
        fs.renameSync(draft, target);
      } catch (error) {
        finish({ ok: false, error: error.message });
        return;
      }
      finish({ ok: true, path: target, bytes: size });
    });
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
  for (const child of activeChildren) {
    try { child.kill("SIGKILL"); } catch {}
  }
  activeChildren.clear();
}

module.exports = {
  buildConcatInput,
  buildArgs,
  exportClip,
  sidecarPath,
  writeSidecar,
  killAll
};
