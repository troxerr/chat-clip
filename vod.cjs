#!/usr/bin/env node
"use strict";

require("./lib/migrate.js").runMigration();

// ClipSpike VOD mode: paste a Twitch VOD link, download its chat replay,
// find the moments chat reacted to, and save each one as a 9:16 clip.
//
//   node vod.cjs <vod link> [--top 15] [--start 1:00:00] [--end 2:30:00]
//                           [--scan-only] [--full] [--sensitivity 1] [--gap 300]
//                           [--hook] [--hook-text "TEXT"] [--captions]
//
// With CLIPSPIKE_EVENTS=1 it writes the same JSONL event protocol as the
// live recorder so the macOS app can drive it.

const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { randomUUID } = require("node:crypto");

const { parseVodUrl, parseTimestamp, formatTimestamp, fetchVodInfo, fetchChat } = require("./lib/twitch-vod.js");
const { scanChat } = require("./lib/vodscan.js");
const { readConfig, reframeSettings, storageSettings } = require("./lib/appconfig.js");
const { createJobStore } = require("./lib/jobstore.js");
const { reframeClip, killAll: killReframes } = require("./lib/reframe.js");
const platform = require("./lib/platform.js");
const overlays = require("./lib/overlays.js");
const captions = require("./lib/captions.js");
const feedback = require("./lib/feedback.js");
const { clipPayload } = require("./lib/clip-webhook.js");
const { createWebhookDelivery } = require("./lib/webhook-delivery.js");
const webhook = createWebhookDelivery({});
const freeTier = require("./lib/freetier.js");

const VERSION = "3.0.0";
const EVENTS = process.env.CLIPSPIKE_EVENTS === "1";
const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
const children = new Set();
const partialDownloads = new Set();
let shuttingDown = false;
let feedbackSession = null;

// Logs session-end once (normal finish or cancel) and announces a review when due.
function endFeedbackSession(details = {}) {
  if (!feedbackSession) return;
  const session = feedbackSession;
  feedbackSession = null;
  try {
    const result = session.end(details);
    if (result && result.ready) emit("review-ready", result.ready);
  } catch {}
}

const bundledRuntimeBin = path.join(__dirname, "runtime", "bin");
if (fs.existsSync(bundledRuntimeBin)) {
  process.env.PATH = bundledRuntimeBin + ":" + (process.env.PATH || "");
}

function parseArgs(argv) {
  const options = { url: "", top: 15, start: null, end: null, scanOnly: false, full: false, sensitivity: null, pre: 15, post: 15, keepChat: true, gap: 300, hook: false, hookText: "", captions: false };
  const rest = [...argv];
  while (rest.length) {
    const arg = rest.shift();
    const value = () => rest.shift();
    if (arg === "--top") options.top = Math.max(0, Math.floor(Number(value()) || 0));
    else if (arg === "--start") options.start = parseTimestamp(value());
    else if (arg === "--end") options.end = parseTimestamp(value());
    else if (arg === "--scan-only") options.scanOnly = true;
    else if (arg === "--full") options.full = true;
    else if (arg === "--sensitivity") options.sensitivity = Number(value());
    else if (arg === "--gap") options.gap = Math.max(30, Math.min(1800, Number(value()) || 300));
    else if (arg === "--hook") options.hook = true;
    else if (arg === "--hook-text") { options.hook = true; options.hookText = String(value() || "").trim(); }
    else if (arg === "--captions") options.captions = true;
    else if (arg === "--pre") options.pre = Math.max(0, Number(value()) || 0);
    else if (arg === "--post") options.post = Math.max(1, Number(value()) || 1);
    else if (!options.url) options.url = arg;
  }
  return options;
}

function emit(type, data = {}) {
  if (EVENTS) {
    try { process.stdout.write(JSON.stringify({ type, at: new Date().toISOString(), ...data }) + "\n"); } catch {}
    return;
  }
  if (type === "vod-info") console.log(`${data.channelName}: “${data.title}” (${formatTimestamp(data.lengthSeconds)})`);
  else if (type === "vod-chat-progress" && data.done) console.log(`Chat replay: ${data.comments} messages.`);
  else if (type === "vod-moments") {
    console.log(`Found ${data.moments.length} moment${data.moments.length === 1 ? "" : "s"} (${data.strong} would have triggered live).`);
    for (const moment of data.moments) console.log(`  ${formatTimestamp(moment.at)}  ${moment.strong ? "★" : " "} ${moment.reason}  (score ${moment.score})`);
  } else if (type === "clip-saved") console.log(`Saved ${data.path}`);
  else if (type === "vod-download-progress" && data.done) console.log(`Saved full VOD to ${data.path}`);
  else if (type === "clip-failed") console.error(`Clip failed at ${formatTimestamp(data.at)}: ${data.error}`);
  else if (type === "error" || type === "fatal") console.error(data.message);
  else if (type === "caption-model-progress" && data.done) console.log(`Downloaded the captions model (${Math.round(data.bytes / 1e6)} MB).`);
  else if (type === "caption-progress") console.log(`  Captions for clip ${data.index}: ${data.stage}${data.cues != null ? ` (${data.cues} captions)` : ""}`);
  else if (type === "vod-done") console.log(`Done. ${data.saved} clip${data.saved === 1 ? "" : "s"} in ${data.folder}`);
}

function fatal(message) {
  emit("fatal", { message });
  shutdown(1);
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  endFeedbackSession({ exitCode: code, cancelled: code === 130 || code === 143 });
  const closed = Array.from(children, (child) => new Promise((resolve) => {
    child.once("close", resolve);
    try { child.kill("SIGKILL"); } catch {}
  }));
  await Promise.allSettled([...closed, killReframes()]);
  for (const file of partialDownloads) {
    try { fs.rmSync(file, { force: true }); } catch {}
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

function have(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 8000 });
  return result.error && result.error.code === "ENOENT" ? null : result;
}

function run(command, args, { onStdoutLine } = {}) {
  if (shuttingDown) return Promise.resolve({ code: -1, stdout: "", stderr: "VOD cancelled." });
  return new Promise((resolve) => {
    let stderr = "";
    let stdout = "";
    let child;
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ code: -1, stdout: "", stderr: error.message });
      return;
    }
    children.add(child);
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (stdout.length > 20000) stdout = stdout.slice(-20000);
      if (!onStdoutLine) return;
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) onStdoutLine(line);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on("error", (error) => { stderr += error.message; });
    child.on("close", (code) => {
      children.delete(child);
      resolve({ code, stdout, stderr: stderr.trim() });
    });
  });
}

async function fetchEmoteNames(channelId) {
  const names = [];
  const urls = ["https://7tv.io/v3/emote-sets/global"];
  if (channelId) urls.push("https://7tv.io/v3/users/twitch/" + channelId);
  const results = await Promise.allSettled(urls.map(async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.emote_set || data).emotes || [];
  }));
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const emote of result.value) if (emote && emote.name) names.push(emote.name);
  }
  return names;
}

function clipStamp(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${h}h${m}m${s}s`;
}

function uniquePath(directory, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(directory, filename);
  for (let n = 2; fs.existsSync(candidate); n += 1) candidate = path.join(directory, `${base}-${n}${ext}`);
  return candidate;
}

function ffmpegSupportsHttps() {
  const result = have("ffmpeg", ["-hide_banner", "-protocols"]);
  return Boolean(result && /\bhttps\b/.test(result.stdout || ""));
}

// Cut [start, start+duration) from the VOD into an MP4 without re-encoding.
async function downloadRange({ vodUrl, playlist, start, duration, target, onProgress }) {
  const partial = target + ".partial";
  partialDownloads.add(partial);
  try {
    return await writeDownload({ vodUrl, playlist, start, duration, target, onProgress, partial });
  } finally {
    try { fs.rmSync(partial, { force: true }); partialDownloads.delete(partial); } catch {}
  }
}

async function writeDownload({ vodUrl, playlist, start, duration, target, onProgress, partial }) {
  const progress = onProgress
    ? (line) => {
      if (!line.startsWith("out_time_us=")) return;
      const seconds = Number(line.slice(12)) / 1e6;
      if (Number.isFinite(seconds) && duration) onProgress(Math.min(1, seconds / duration));
    }
    : undefined;
  let result;
  if (playlist) {
    // Direct HLS seek: accurate to the nearest keyframe (about 2s on Twitch).
    result = await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      ...(onProgress ? ["-progress", "pipe:1"] : []),
      "-ss", String(Math.max(0, start)), "-i", playlist,
      ...(duration ? ["-t", String(duration)] : []),
      "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart", "-f", "mp4", partial
    ], { onStdoutLine: progress });
  } else {
    // Fallback for an FFmpeg build without HTTPS: Streamlink fetches, FFmpeg remuxes.
    const ts = target + ".ts.partial";
    partialDownloads.add(ts);
    const args = ["--force", "--hls-start-offset", formatTimestamp(start), "-o", ts, vodUrl, "best"];
    if (duration) args.splice(1, 0, "--hls-duration", formatTimestamp(Math.ceil(duration)));
    const fetched = await run("streamlink", args);
    if (fetched.code !== 0) {
      try { fs.rmSync(ts, { force: true }); partialDownloads.delete(ts); } catch {}
      return { ok: false, error: fetched.stderr || fetched.stdout || `Streamlink exited with ${fetched.code}` };
    }
    result = await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", ts,
      "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart", "-f", "mp4", partial
    ]);
    try { fs.rmSync(ts, { force: true }); partialDownloads.delete(ts); } catch {}
  }
  let size = 0;
  try { size = fs.statSync(partial).size; } catch {}
  if (shuttingDown || result.code !== 0 || size <= 0) {
    return { ok: false, error: result.stderr || `FFmpeg exited with code ${result.code}` };
  }
  fs.renameSync(partial, target);
  return { ok: true, path: target, bytes: size };
}

// Decides once per run which overlays can be burned in, and warns once about
// anything missing. Returns { hook, captions, ffmpeg, whisper, model }.
async function planOverlays(options, reframeConfig) {
  const plan = { hook: false, captions: false, ffmpeg: null, whisper: null, model: null };
  if (!options.hook && !options.captions) return plan;
  if (!reframeConfig.enabled) {
    emit("error", { message: "Hook lines and captions need the 9:16 reframe, which is turned off. Saving clips without them." });
    return plan;
  }
  let wantHook = options.hook;
  let wantCaptions = options.captions;
  if (wantHook && !overlays.findFont()) {
    emit("error", { message: "The hook line needs a bold system font (Arial Bold). Saving clips without it." });
    wantHook = false;
  }
  if (wantHook && !overlays.overlayFfmpeg({ needText: true })) {
    emit("error", { message: "The hook line needs an FFmpeg with drawtext: brew install ffmpeg-full" });
    wantHook = false;
  }
  if (wantCaptions) {
    plan.whisper = captions.findWhisper();
    if (!plan.whisper) {
      emit("error", { message: "Captions need whisper.cpp: brew install whisper-cpp" });
      wantCaptions = false;
    } else if (!overlays.overlayFfmpeg({ needSubtitles: true })) {
      emit("error", { message: "Captions need an FFmpeg with libass: brew install ffmpeg-full" });
      wantCaptions = false;
    }
  }
  if (wantCaptions) {
    plan.model = captions.modelPath();
    if (!captions.modelReady(plan.model)) emit("caption-model-progress", { fraction: 0, bytes: 0, total: 0 });
    const model = await captions.ensureModel({
      file: plan.model,
      onProgress: (progress) => emit("caption-model-progress", { ...progress, fraction: round(progress.fraction) })
    });
    if (!model.ok) {
      emit("error", { message: `Could not download the captions model: ${model.error}. Saving clips without captions.` });
      wantCaptions = false;
    }
  }
  plan.ffmpeg = overlays.overlayFfmpeg({ needText: wantHook, needSubtitles: wantCaptions });
  if (!plan.ffmpeg && wantHook && wantCaptions) {
    // No single build has both; keep captions (the bigger win) if possible.
    emit("error", { message: "No FFmpeg here has both drawtext and libass: brew install ffmpeg-full. Skipping the hook line." });
    wantHook = false;
    plan.ffmpeg = overlays.overlayFfmpeg({ needSubtitles: true });
  }
  plan.hook = wantHook && Boolean(plan.ffmpeg);
  plan.captions = wantCaptions && Boolean(plan.ffmpeg);
  return plan;
}

// Builds this clip's extra filter steps. Never throws: a failed overlay is
// reported and the clip is saved without it.
async function buildClipOverlays({ plan, options, moment, comments, emotes, input, width, height, index, metadata }) {
  const none = { filters: [], cleanup() {} };
  if (!plan.hook && !plan.captions) return none;
  let dir;
  try { dir = overlays.makeOverlayDir(); } catch (error) {
    emit("error", { message: error.message });
    return none;
  }
  const filters = [];
  if (plan.hook) {
    try {
      const text = options.hookText || overlays.pickHookText(comments, moment.at, { emotes });
      if (text) {
        const prepared = overlays.prepareHook(dir, text, { width, height });
        if (prepared) {
          filters.push(...prepared.filters);
          metadata.hook = { text, lines: prepared.lines, source: options.hookText ? "manual" : "chat", burned: true };
        }
      }
    } catch (error) {
      emit("error", { message: `Hook line skipped: ${error.message}` });
    }
  }
  if (plan.captions) {
    try {
      emit("caption-progress", { index, stage: "transcribing", at: moment.at });
      const started = Date.now();
      const result = await captions.transcribeClip({ run, whisperPath: plan.whisper, model: plan.model, input, workDir: dir });
      if (!result.ok) throw new Error(result.error);
      const words = overlays.wordsFromWhisperJson(result.json);
      const cues = overlays.groupWords(words, { maxWords: 3 });
      emit("caption-progress", { index, stage: "transcribed", cues: cues.length, seconds: round((Date.now() - started) / 1000) });
      if (cues.length) {
        const assFile = path.join(dir, "captions.ass");
        fs.writeFileSync(assFile, overlays.buildAss(cues, { width, height }));
        filters.push(overlays.buildCaptionFilter({ assFile }));
      }
      metadata.captions = { cues: cues.length, words: words.length, model: path.basename(plan.model), burned: cues.length > 0, text: cues.map((cue) => cue.text).join(" "), lines: cues.map((cue) => ({ start: round(cue.start), end: round(cue.end), text: cue.text })) };
    } catch (error) {
      emit("error", { message: `Captions skipped for this clip: ${error.message}` });
    }
  }
  return {
    filters,
    cleanup() { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const parsed = parseVodUrl(options.url);
  if (!parsed) {
    console.error("Paste a Twitch VOD link, like https://www.twitch.tv/videos/1234567890");
    process.exit(2);
  }
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) return fatal(`Node 22 or newer is required (found ${process.versions.node}).`);
  const needsVideo = !options.scanOnly;
  if (!have("ffmpeg", ["-version"]) && needsVideo) return fatal("Missing ffmpeg. Install it with: brew install ffmpeg");
  if (!have("streamlink", ["--version"]) && needsVideo) return fatal("Missing streamlink. Install it with: brew install streamlink");

  const configResult = readConfig();
  const reframeConfig = reframeSettings(configResult.config);
  const storageConfig = storageSettings(configResult.config);
  const jobStore = createJobStore();

  let info;
  try {
    info = await fetchVodInfo(parsed.id);
  } catch (error) {
    return fatal(error.message);
  }
  const vodUrl = `https://www.twitch.tv/videos/${info.id}`;
  emit("vod-info", { ...info, url: vodUrl, version: VERSION });

  const start = Math.max(0, options.start ?? parsed.startAt ?? 0);
  // (feedback session starts below, once the range is known)
  const end = Math.min(info.lengthSeconds || Infinity, options.end ?? Infinity);
  if (!(end > start)) return fatal("The end time must be after the start time and inside the VOD.");
  if (!options.scanOnly) {
    feedbackSession = feedback.startSession({
      mode: "vod",
      channel: info.channel || "",
      vodId: info.id,
      extra: { rangeStartSec: start, rangeEndSec: Number.isFinite(end) ? end : null, top: options.top, gapSec: options.gap, hook: options.hook, captions: options.captions }
    });
  }

  const outputRoot = platform.outputRoot();
  const channel = info.channel || "twitch";
  const folder = path.join(outputRoot, channel);
  const vodFolder = path.join(folder, `vod-${info.id}`);
  fs.mkdirSync(vodFolder, { recursive: true });

  // Resolve the playlist once, in parallel with the chat download.
  const playlistPromise = needsVideo
    ? (ffmpegSupportsHttps()
      ? run("streamlink", ["--stream-url", vodUrl, "best"]).then((result) => {
        const url = (result.stdout || "").trim().split("\n").pop();
        return result.code === 0 && /^https?:\/\//.test(url) ? url : null;
      })
      : Promise.resolve(null))
    : Promise.resolve(null);

  if (options.full) {
    const playlist = await playlistPromise;
    const target = uniquePath(vodFolder, `${channel}-vod${info.id}${start || Number.isFinite(options.end) ? `-${clipStamp(start)}-${clipStamp(end)}` : ""}.mp4`);
    const duration = Number.isFinite(end) ? end - start : 0;
    emit("vod-download-progress", { fraction: 0, path: target });
    let lastSent = 0;
    const result = await downloadRange({
      vodUrl, playlist, start, duration, target,
      onProgress: (fraction) => {
        if (Date.now() - lastSent < 500) return;
        lastSent = Date.now();
        emit("vod-download-progress", { fraction: round(fraction), path: target });
      }
    });
    if (!result.ok) return fatal(`VOD download failed: ${result.error}`);
    emit("vod-download-progress", { fraction: 1, path: target, done: true, bytes: result.bytes });
  }

  // Up to 10 minutes of chat before the start only warm up the detector's baseline.
  const chatStart = Math.max(0, start - 600);
  emit("vod-chat-progress", { fraction: 0, comments: 0 });
  let lastSent = 0;
  let comments;
  try {
    comments = await fetchChat(info.id, {
      start: chatStart,
      end: Number.isFinite(end) ? end : start + 86400,
      onProgress: ({ fraction, comments: count }) => {
        if (Date.now() - lastSent < 500) return;
        lastSent = Date.now();
        emit("vod-chat-progress", { fraction: round(fraction), comments: count });
      }
    });
  } catch (error) {
    return fatal(`Could not download chat: ${error.message}`);
  }
  const chatFile = path.join(vodFolder, `chat-${clipStamp(chatStart)}-${clipStamp(Number.isFinite(end) ? end : comments.length ? comments[comments.length - 1].offset : start)}.json`);
  fs.writeFileSync(chatFile, JSON.stringify({ vod: info, start, end, comments }, null, 0));
  emit("vod-chat-progress", { fraction: 1, comments: comments.length, done: true, path: chatFile });

  const emoteNames = await fetchEmoteNames(info.channelId).catch(() => []);
  const scan = scanChat(comments, {
    emotes: emoteNames,
    start: chatStart,
    reportFrom: start,
    end,
    limit: options.top,
    minGapSec: options.gap,
    settings: Number.isFinite(options.sensitivity) ? { sensitivity: options.sensitivity } : {}
  });
  emit("vod-moments", { total: scan.total, strong: scan.strong, moments: scan.moments, activity: scan.activity, windowSec: scan.windowSec });

  if (options.scanOnly) {
    emit("vod-done", { saved: 0, folder: vodFolder, chat: chatFile });
    return shutdown(0);
  }

  const playlist = await playlistPromise;
  const overlayPlan = await planOverlays(options, reframeConfig);
  let saved = 0;
  for (const moment of scan.moments) {
    const clipStart = Math.max(start, moment.at - options.pre);
    const clipEnd = Math.min(end, moment.at + options.post);
    const base = `${channel}-vod${info.id}-${clipStamp(moment.at)}-auto`;
    const rawTarget = uniquePath(folder, `${base}.mp4`);
    emit("clip-requested", { reason: moment.reason, trigger: "vod", at: moment.at });
    const cut = await downloadRange({ vodUrl, playlist, start: clipStart, duration: clipEnd - clipStart, target: rawTarget });
    if (shuttingDown) return;
    if (!cut.ok) {
      emit("clip-failed", { at: moment.at, reason: moment.reason, error: cut.error });
      continue;
    }

    const metadata = {
      version: 3,
      id: randomUUID(),
      channel,
      createdAt: new Date().toISOString(),
      source: "vod",
      vod: { id: info.id, url: `${vodUrl}?t=${clipStamp(clipStart)}`, title: info.title, createdAt: info.createdAt },
      vodOffsetSec: round(moment.at),
      trigger: "vod",
      reason: moment.reason,
      durationSec: round(clipEnd - clipStart),
      preRollSec: round(moment.at - clipStart),
      postRollSec: round(clipEnd - moment.at),
      score: moment.score,
      participants: moment.participants,
      reactions: moment.reactions,
      messages: moment.messages,
      topEmotes: moment.topEmotes,
      reframed: false,
      raw: { file: path.basename(rawTarget) },
      vertical: null,
      file: path.basename(rawTarget)
    };

    let primary = rawTarget;
    if (reframeConfig.enabled) {
      const verticalTarget = uniquePath(folder, `${base}-9x16.mp4`);
      const extras = await buildClipOverlays({
        plan: overlayPlan, options, moment, comments, emotes: emoteNames,
        input: rawTarget, width: reframeConfig.width, height: reframeConfig.height,
        index: saved + 1, metadata
      });
      if (shuttingDown) { extras.cleanup(); return; }
      // Free plan: after the weekly allowance, clips carry a watermark.
      const tier = freeTier.status({ dir: jobStore.stateDir });
      const watermark = tier.watermark ? freeTier.prepareWatermark() : null;
      if (tier.watermark && !watermark) emit("error", { message: "Could not prepare the free-plan watermark. Saving this clip without it." });
      const reframeOptions = {
        input: rawTarget,
        output: verticalTarget,
        watermark,
        width: reframeConfig.width,
        height: reframeConfig.height,
        crf: reframeConfig.crf,
        preset: reframeConfig.preset,
        blur: reframeConfig.blur,
        encoder: reframeConfig.encoder,
        bitrate: reframeConfig.bitrate,
        layout: reframeConfig.layout,
        camHeightRatio: reframeConfig.camHeightRatio,
        facecamCorner: reframeConfig.facecamCorner,
        facecam: reframeConfig.facecam,
        gameplay: reframeConfig.gameplay,
        priority: reframeConfig.priority
      };
      let reframe = await reframeClip({ ...reframeOptions, extraFilters: extras.filters, ffmpegPath: extras.filters.length ? overlayPlan.ffmpeg : "ffmpeg" });
      if (!shuttingDown && !reframe.ok && extras.filters.length) {
        emit("error", { message: `Could not burn in the overlay (${reframe.error.split("\n").pop()}). Saving the clip without it.` });
        if (metadata.hook) metadata.hook.burned = false;
        if (metadata.captions) metadata.captions.burned = false;
        reframe = await reframeClip(reframeOptions);
      }
      extras.cleanup();
      if (shuttingDown) return;
      if (reframe.ok) {
        primary = verticalTarget;
        metadata.reframed = true;
        metadata.watermarked = Boolean(watermark);
        if (tier.plan === "free" && !tier.watermark) freeTier.recordClip({ dir: jobStore.stateDir });
        if (tier.plan === "free") emit("free-tier", freeTier.status({ dir: jobStore.stateDir }));
        metadata.vertical = { file: path.basename(verticalTarget), width: reframeConfig.width, height: reframeConfig.height, layout: reframe.layout };
        metadata.file = path.basename(verticalTarget);
        if (!storageConfig.keepRaw) {
          try { fs.rmSync(rawTarget, { force: true }); } catch {}
        }
      } else {
        metadata.reframeError = reframe.error;
        emit("error", { message: `Reframe failed: ${reframe.error}. Keeping the landscape clip.` });
      }
    }
    metadata.storage = { provider: "local", path: primary, file: path.basename(primary) };
    const sidecar = rawTarget.replace(/\.mp4$/, ".json");
    try { fs.writeFileSync(sidecar, JSON.stringify(metadata, null, 2) + "\n"); } catch {}

    saved += 1;
    if (feedbackSession) {
      feedbackSession.countClip();
      feedback.logClipCreated({
        clipId: metadata.id,
        sessionId: feedbackSession.sessionId,
        mode: "vod",
        channel,
        vodId: info.id,
        vodOffsetSec: metadata.vodOffsetSec,
        path: primary,
        signals: moment.signals || { score: moment.score, chatters: moment.participants, messages: moment.messages, topEmotes: moment.topEmotes },
        hook: metadata.hook && metadata.hook.burned !== false ? metadata.hook : null,
        captions: metadata.captions && metadata.captions.burned ? metadata.captions : null
      });
    }
    try {
      jobStore.addHistory({
        id: metadata.id,
        channel,
        createdAt: metadata.createdAt,
        reason: `VOD ${formatTimestamp(moment.at)} · ${moment.reason}`,
        provider: "local",
        localPath: primary,
        remotePath: null,
        webLink: metadata.vod.url,
        deletedLocal: false,
        status: "local",
        updatedAt: new Date().toISOString()
      });
      emit("history-updated", { items: jobStore.listHistory() });
    } catch (error) {
      emit("error", { message: `Could not update clip history: ${error.message}` });
    }
    await webhook.deliver(clipPayload("clip.saved", metadata, { localPath: primary })).catch((error) => emit("error", { message: error.message }));
    emit("clip-saved", {
      path: primary,
      provider: "local",
      storageProvider: "local",
      remotePath: null,
      webLink: metadata.vod.url,
      deletedLocal: false,
      reframed: metadata.reframed,
      queued: false,
      sidecar,
      metadata,
      count: saved
    });
  }

  endFeedbackSession({ moments: scan.moments.length });
  emit("vod-done", { saved, total: scan.moments.length, folder, chat: chatFile });
  shutdown(0);
}

if (require.main === module) {
  main().catch((error) => fatal(error.stack || error.message));
}

module.exports = { parseArgs, clipStamp };
