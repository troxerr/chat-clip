"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { videoEncoderArgs, bitrateFor } = require("./encoder.js");
const { applyPriority } = require("./priority.js");

const activeChildren = new Set();

const FACECAM_CORNERS = {
  "top-left": { x: 0.015, y: 0.02, w: 0.25, h: 0.28 },
  "top-right": { x: 0.735, y: 0.02, w: 0.25, h: 0.28 },
  "bottom-left": { x: 0.015, y: 0.70, w: 0.25, h: 0.28 },
  "bottom-right": { x: 0.735, y: 0.70, w: 0.25, h: 0.28 }
};

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function normalizeRect(rect, fallback) {
  const source = rect && typeof rect === "object" ? rect : fallback;
  const x = Math.min(0.95, Math.max(0, Number.isFinite(Number(source.x)) ? Number(source.x) : fallback.x));
  const y = Math.min(0.95, Math.max(0, Number.isFinite(Number(source.y)) ? Number(source.y) : fallback.y));
  const rawW = Number.isFinite(Number(source.w)) ? Number(source.w) : fallback.w;
  const rawH = Number.isFinite(Number(source.h)) ? Number(source.h) : fallback.h;
  const w = Math.min(1 - x, Math.max(0.05, rawW));
  const h = Math.min(1 - y, Math.max(0.05, rawH));
  return { x: round4(x), y: round4(y), w: round4(w), h: round4(h) };
}

function normalizeSplitOptions({
  width = 1080,
  height = 1920,
  camHeightRatio = 0.35,
  facecamCorner = "bottom-left",
  facecam = null,
  gameplay = null
} = {}) {
  const ratioNum = Number(camHeightRatio);
  const ratio = round4(Math.min(0.5, Math.max(0.2, Number.isFinite(ratioNum) ? ratioNum : 0.35)));
  const camHeight = Math.max(2, Math.floor((height * ratio) / 2) * 2);
  const gameHeight = Math.max(2, height - camHeight);
  const cornerFallback = FACECAM_CORNERS[facecamCorner] || FACECAM_CORNERS["bottom-left"];
  const facecamRect = normalizeRect(facecam, cornerFallback);
  const gameplayRect = normalizeRect(gameplay, { x: 0, y: 0, w: 1, h: 1 });
  return {
    width,
    height,
    camHeightRatio: ratio,
    camHeight,
    gameHeight,
    facecam: facecamRect,
    gameplay: gameplayRect
  };
}

// Tail of every filter graph: extra steps, then pixel format. With a watermark
// {file} the clip is branched and a pre-rendered PAM image is overlaid near the bottom.
function filterTail(extraFilters, watermark, width) {
  const extras = (extraFilters || []).filter(Boolean);
  if (!watermark || !watermark.file) return [...extras, "format=yuv420p[v]"].join(",");
  // Windows paths: use forward slashes and escape the drive colon for the filtergraph parser.
  const wmFile = watermark.file.replace(/\\/g, "/");
  if (!/^(?:[A-Za-z]:)?[A-Za-z0-9_\/.~\-]+$/.test(wmFile)) throw new Error(`Unsafe watermark path: ${watermark.file}`);
  const wmArg = /^[A-Za-z]:/.test(wmFile) ? `'${wmFile.replace(":", "\\:")}'` : wmFile;
  const wmWidth = Math.max(2, Math.round((560 * width) / 1080 / 2) * 2);
  return [
    [...extras, "null[vm]"].join(","),
    `movie=${wmArg},scale=${wmWidth}:-1,format=rgba,colorchannelmixer=aa=0.85[wm]`,
    "[vm][wm]overlay=(W-w)/2:H-h-H*0.12:format=auto,format=yuv420p[v]"
  ].join(";");
}

function buildSplitReframeFilter({
  width = 1080,
  height = 1920,
  camHeightRatio = 0.35,
  facecamCorner = "bottom-left",
  facecam = null,
  gameplay = null,
  extraFilters = [],
  watermark = null
} = {}) {
  const opts = normalizeSplitOptions({ width, height, camHeightRatio, facecamCorner, facecam, gameplay });
  const fc = opts.facecam;
  const gp = opts.gameplay;
  const hasCustomGameplay = gp.x > 0 || gp.y > 0 || gp.w < 1 || gp.h < 1;
  const gameplayCrop = hasCustomGameplay ? `crop=w=iw*${gp.w}:h=ih*${gp.h}:x=iw*${gp.x}:y=ih*${gp.y},` : "";
  return [
    "[0:v]split=2[cam_src][game_src]",
    `[cam_src]crop=w=iw*${fc.w}:h=ih*${fc.h}:x=iw*${fc.x}:y=ih*${fc.y},scale=${opts.width}:${opts.camHeight}:force_original_aspect_ratio=increase,crop=${opts.width}:${opts.camHeight},setsar=1[camout]`,
    `[game_src]${gameplayCrop}scale=${opts.width}:${opts.gameHeight}:force_original_aspect_ratio=increase,crop=${opts.width}:${opts.gameHeight},setsar=1[gameout]`,
    "[camout][gameout]vstack=inputs=2," + filterTail(extraFilters, watermark, opts.width)
  ].join(";");
}

// extraFilters: optional filter steps (drawtext, subtitles, ...) run on the
// finished 9:16 frame inside the same encode. Existing callers pass nothing.
function buildReframeFilter({
  width,
  height,
  blur,
  layout = "blur",
  mode,
  camHeightRatio,
  facecamCorner,
  facecam,
  gameplay,
  extraFilters = [],
  watermark = null
}) {
  const resolvedLayout = String(mode || layout || "blur").toLowerCase();
  if (resolvedLayout === "split") {
    return buildSplitReframeFilter({ width, height, camHeightRatio, facecamCorner, facecam, gameplay, extraFilters, watermark });
  }
  const halfWidth = Math.max(2, Math.floor(width / 4) * 2);
  const halfHeight = Math.max(2, Math.floor(height / 4) * 2);
  return [
    "[0:v]split=2[bg][fg]",
    `[bg]scale=${halfWidth}:${halfHeight}:force_original_aspect_ratio=increase,crop=${halfWidth}:${halfHeight},gblur=sigma=${blur}:steps=5,scale=${width}:${height},setsar=1[bgout]`,
    `[fg]scale=${width}:${height}:force_original_aspect_ratio=decrease,setsar=1[fgout]`,
    "[bgout][fgout]overlay=(W-w)/2:(H-h)/2:format=auto," + filterTail(extraFilters, watermark, width)
  ].join(";");
}

function buildArgs({
  input,
  output,
  width,
  height,
  blur,
  bitrate = "8M",
  encoder,
  layout,
  mode,
  camHeightRatio,
  facecamCorner,
  facecam,
  gameplay,
  extraFilters,
  watermark
}) {
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-nostdin",
    "-y",
    "-i", input,
    "-filter_complex", buildReframeFilter({
      width,
      height,
      blur,
      layout,
      mode,
      camHeightRatio,
      facecamCorner,
      facecam,
      gameplay,
      extraFilters,
      watermark
    }),
    "-map", "[v]",
    "-map", "0:a?",
    ...videoEncoderArgs({ codec: encoder, bitrate }),
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "160k",
    "-movflags", "+faststart",
    "-f", "mp4",
    output
  ];
}

function reframeClip({
  input,
  output,
  width = 1080,
  height = 1920,
  crf = 20,
  preset = "veryfast",
  blur = 20,
  bitrate,
  encoder,
  priority,
  ffmpegPath = "ffmpeg",
  timeoutMs = 180000,
  layout = "blur",
  mode,
  camHeightRatio,
  facecamCorner,
  facecam,
  gameplay,
  extraFilters = [],
  watermark = null
}) {
  const resolvedLayout = String(mode || layout || "blur").toLowerCase();
  if (!input || !fs.existsSync(input)) {
    return Promise.resolve({ ok: false, error: `Input not found: ${input}` });
  }
  if (!output) return Promise.resolve({ ok: false, error: "No output target." });

  const draft = output + ".partial";
  try {
    fs.mkdirSync(path.dirname(output), { recursive: true });
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
      child = spawn(ffmpegPath, buildArgs({
        input,
        output: draft,
        width,
        height,
        blur,
        bitrate: bitrate || bitrateFor(width, height),
        encoder,
        layout: resolvedLayout,
        camHeightRatio,
        facecamCorner,
        facecam,
        gameplay,
        extraFilters,
        watermark
      }), {
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
      finish({ ok: false, error: `Reframe timed out after ${Math.round(timeoutMs / 1000)}s.` });
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
        finish({ ok: false, error: stderr.trim() || `FFmpeg reframe exited with code ${code}.` });
        return;
      }
      try {
        fs.renameSync(draft, output);
      } catch (error) {
        finish({ ok: false, error: error.message });
        return;
      }
      finish({ ok: true, path: output, bytes: size, width, height, layout: resolvedLayout });
    });
  });
}

function killAll() {
  for (const child of activeChildren) {
    try { child.kill("SIGKILL"); } catch {}
  }
  activeChildren.clear();
}

module.exports = {
  FACECAM_CORNERS,
  normalizeSplitOptions,
  buildSplitReframeFilter,
  buildReframeFilter,
  buildArgs,
  reframeClip,
  killAll
};
