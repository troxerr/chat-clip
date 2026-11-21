"use strict";

require("./lib/migrate.js").runMigration();

const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const readline = require("node:readline");
const { randomUUID } = require("node:crypto");

const { evaluateReaction, isReaction, collectEmotes, topEmotes } = require("./dist/reactions.js");
const feedback = require("./lib/feedback.js");
const { startMonitor } = require("./lib/monitor.js");
const monitorPolicy = require("./lib/monitor-policy.js");
const { parseChatLine, isPrivileged, isClipCommand, roomId } = require("./dist/irc.js");
const { settingsFor } = require("./dist/config.js");
const platform = require("./lib/platform.js");
const { resolveEncoder } = require("./lib/encoder.js");
const { parseSource } = require("./lib/stream-source.js");
const { relaySettings, connectKickChat } = require("./lib/kick-chat.js");
const { findKickBrowser } = require("./lib/kick-browser.js");
const { parseManifest, planClip } = require("./lib/manifest.js");
const { readConfig, reframeSettings, storageSettings } = require("./lib/appconfig.js");
const { createStorageProvider, storageLabel } = require("./lib/storage/index.js");
const { createJobStore } = require("./lib/jobstore.js");
const { writeCrashReport } = require("./lib/crashlog.js");
const { exportClip, writeSidecar, killAll: killExports } = require("./lib/exporter.js");
const { reframeClip, killAll: killReframes } = require("./lib/reframe.js");
const freeTier = require("./lib/freetier.js");

const VERSION = "3.0.0";
const settings = settingsFor("desktop");
const configResult = readConfig();
const reframeConfig = reframeSettings(configResult.config);
const storageConfig = storageSettings(configResult.config);
let storageProvider = null;
let storageProviderError = null;
const jobStore = createJobStore();
const QUEUE_INTERVAL_MS = Math.max(1000, Number(process.env.CLIPSPIKE_QUEUE_MS) || 60000);
const RETRY_BASE_MS = Math.max(1000, Number(process.env.CLIPSPIKE_RETRY_MS) || 60000);
let queueTimer = null;
let queueBusy = false;
try {
  storageProvider = createStorageProvider(storageConfig);
} catch (error) {
  storageProviderError = error.message;
}
let streamSource;
try { streamSource = parseSource(process.argv[2]); } catch (error) {
  console.error(error.message);
  process.exit(2);
}
const channel = streamSource.key;
let kickRelay;
let kickBrowser;
if (streamSource.platform === "kick") {
  try {
    kickRelay = relaySettings(configResult.config);
    if (!kickRelay.token) throw new Error("Kick relay is not paired. Run npm run kick:relay and complete its local setup first.");
  } catch (error) { console.error(error.message); process.exit(2); }
}

const outputRoot = platform.outputRoot();
const output = streamSource.platform === "kick" ? path.join(outputRoot, "kick", streamSource.slug) : path.join(outputRoot, channel);
try {
  fs.mkdirSync(output, { recursive: true });
} catch (error) {
  console.error(`Could not create the clip folder (${output}): ${error.message}`);
  process.exit(1);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "clipspike-"));
const manifestFile = path.join(temp, "segments.csv");
const EVENTS = process.env.CLIPSPIKE_EVENTS === "1";
const smokeChat = streamSource.platform === "twitch" && Boolean(process.env.CLIPSPIKE_SMOKE && process.env.CLIPSPIKE_INPUT);
let smokeSpikeSent = false;

let chat = null;
let source = null;
let encoder = null;
let stopping = false;
let restarting = false;
let joined = false;
let room = "";
let emotes = new Set();
let paceHistory = [];
let viewers = new Set();
let reactors = new Set();
let emoteCounts = new Map();
let messageCount = 0;
let mediaTime = 0;
let lastFrameAt = 0;
let recordToken = 0;
let pending = null;
let exporting = null;
let exportingFiles = new Set();
let exportPromise = null;
let lastAuto = 0;
let lastAutoTrigger = null;
let monitor = null;
let lastWindow = null;
let profileVersion = "default";
let lastCommand = 0;
let clipCount = 0;
let tickBusy = false;
let ticker = null;
let emoteTimer = null;

const round = (value) => Math.round((Number(value) || 0) * 100) / 100;

function emit(type, data = {}) {
  if (monitor && ["clip-requested", "clip-exported", "clip-reframed", "clip-uploading", "clip-uploaded", "clip-failed", "error", "fatal"].includes(type)) {
    monitor.record({ kind: "pipeline", at: new Date().toISOString(), event: type,
      clipId: data.clipId || data.metadata?.id || null });
  }
  if (EVENTS) {
    try {
      process.stdout.write(JSON.stringify({ type, at: new Date().toISOString(), platform: streamSource.platform, ...data }) + "\n");
    } catch {}
    return;
  }
  if (type === "ready") {
    console.log(`Monitoring #${channel}. Clips save in ${output}. Press Control-C to stop.`);
  } else if (type === "clip-requested") {
    console.log(`Highlight: ${data.reason}`);
  } else if (type === "clip-saved") {
    console.log(`Saved ${data.path}`);
  } else if (type === "clip-failed") {
    console.error(`Clip export failed: ${data.error}`);
  } else if (type === "error" || type === "fatal") {
    console.error(data.message);
  }
}

function safeUnlink(file) {
  try { fs.unlinkSync(path.join(temp, file)); } catch {}
}

function listSegments() {
  try {
    return fs.readdirSync(temp).filter((file) => /^\d{8}\.ts$/.test(file)).sort();
  } catch {
    return [];
  }
}

function readManifest() {
  try {
    return parseManifest(fs.readFileSync(manifestFile, "utf8"));
  } catch {
    return [];
  }
}

function stamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const pad = (number) => String(number).padStart(2, "0");
  return `${safe.getFullYear()}${pad(safe.getMonth() + 1)}${pad(safe.getDate())}-${pad(safe.getHours())}${pad(safe.getMinutes())}${pad(safe.getSeconds())}`;
}

function uniquePath(directory, filename) {
  const extension = path.extname(filename);
  const stem = extension ? filename.slice(0, -extension.length) : filename;
  let target = path.join(directory, filename);
  let suffix = 2;
  while (fs.existsSync(target)) {
    target = path.join(directory, `${stem}-${suffix}${extension}`);
    suffix += 1;
  }
  return target;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 160);
}

let feedbackSession = null;

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  if (feedbackSession) {
    try {
      const result = feedbackSession.end({ exitCode: code });
      if (result && result.ready) emit("review-ready", result.ready);
    } catch {}
    feedbackSession = null;
  }
  try { clearInterval(ticker); } catch {}
  try { clearInterval(emoteTimer); } catch {}
  try { clearInterval(queueTimer); } catch {}
  try { chat && chat.close(); } catch {}
  pending = null;

  const children = [source, encoder].filter((child) => child && child.exitCode === null && child.signalCode === null);
  let remaining = children.length;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}
    Promise.resolve(monitor?.close()).finally(() => setTimeout(() => process.exit(code), 100));
  };

  for (const child of children) {
    child.once("close", () => {
      remaining -= 1;
      if (remaining <= 0) finish();
    });
  }

  try { source && source.kill("SIGTERM"); } catch {}
  try { encoder && encoder.kill("SIGTERM"); } catch {}
  try { killExports(); } catch {}
  try { killReframes(); } catch {}
  emit("status", { recording: false, joined: false, stopping: true });

  if (remaining <= 0) {
    finish();
    return;
  }
  setTimeout(finish, 1500);
}

function fatal(message) {
  emit("fatal", { message });
  shutdown(1);
}

// Bundled binaries: FFmpeg in runtime/bin, and on Windows a portable Streamlink
// folder (it keeps its own Python) in runtime/streamlink/bin.
const bundledDirs = [path.join(__dirname, "runtime", "bin"), path.join(__dirname, "runtime", "streamlink", "bin")]
  .filter((dir) => fs.existsSync(dir));
if (bundledDirs.length) {
  process.env.PATH = [...bundledDirs, process.env.PATH || ""].join(path.delimiter);
}

function preflight() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < 22) {
    fatal(`Node 22 or newer is required (found ${process.versions.node}).`);
    return false;
  }
  const win = process.platform === "win32";
  const checks = [
    ...(process.env.CLIPSPIKE_INPUT ? [] : [["streamlink", ["--version"], win ? "winget install Streamlink.Streamlink" : "brew install streamlink"]]),
    ["ffmpeg", ["-version"], win ? "winget install Gyan.FFmpeg" : "brew install ffmpeg"]
  ];
  for (const [command, args, hint] of checks) {
    const result = spawnSync(command, args, { stdio: "ignore", timeout: 8000 });
    if (result.error && result.error.code === "ENOENT") {
      fatal(`Missing ${command}. Install it with: ${hint}`);
      return false;
    }
  }
  if (streamSource.platform === "kick" && !process.env.CLIPSPIKE_INPUT) {
    try { kickBrowser = findKickBrowser({ config: configResult.config }); } catch (error) {
      fatal(error.message);
      return false;
    }
  }
  // Pick the encoder now so the first export does not stall on the probe.
  if (reframeConfig.encoder === "auto") reframeConfig.encoder = resolveEncoder();
  return true;
}

function record() {
  if (stopping) return;
  fs.writeFileSync(manifestFile, "");
  mediaTime = 0;
  lastFrameAt = 0;
  const token = ++recordToken;

  let src;
  let enc;
  try {
    const inputFile = process.env.CLIPSPIKE_INPUT;
    src = inputFile
      ? spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-re", "-i", path.resolve(inputFile), "-c", "copy", "-f", "mpegts", "pipe:1"], {
        stdio: ["ignore", "pipe", "inherit"]
      })
      : spawn("streamlink", ["--retry-streams", "30", "--retry-open", "3", ...(kickBrowser ? ["--webbrowser-executable", kickBrowser] : []), "--stdout", streamSource.url, "best"], {
        stdio: ["ignore", "pipe", "inherit"]
      });
    enc = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-stats_period", "0.25", "-progress", "pipe:3",
      "-i", "pipe:0", "-c", "copy", "-f", "segment", "-segment_time", "3",
      "-segment_list", manifestFile, "-segment_list_size", "100", "-segment_list_type", "csv",
      "-segment_format", "mpegts", path.join(temp, "%08d.ts")
    ], { stdio: ["pipe", "ignore", "inherit", "pipe"] });
  } catch (error) {
    emit("error", { message: `Could not launch the recorder: ${error.message}` });
    setTimeout(record, 15000);
    return;
  }

  source = src;
  encoder = enc;

  if (enc.stdio && enc.stdio[3]) {
    readline.createInterface({ input: enc.stdio[3] }).on("line", (line) => {
      if (token !== recordToken) return;
      if (!line.startsWith("out_time_us=")) return;
      const seconds = Number(line.slice(12)) / 1e6;
      if (Number.isFinite(seconds) && seconds >= 0 && seconds > mediaTime) {
        mediaTime = seconds;
        lastFrameAt = Date.now();
      }
    });
  }

  src.on("error", (error) => {
    if (token !== recordToken) return;
    emit("error", { message: `Streamlink: ${error.message}` });
    try { enc.kill("SIGTERM"); } catch {}
  });
  enc.on("error", (error) => {
    if (token !== recordToken) return;
    emit("error", { message: `FFmpeg: ${error.message}` });
    try { src.kill("SIGTERM"); } catch {}
  });
  if (enc.stdin) enc.stdin.on("error", () => {});
  if (src.stdout && enc.stdin) src.stdout.pipe(enc.stdin);

  enc.on("close", () => {
    if (token !== recordToken) return;
    try { src.kill("SIGTERM"); } catch {}
    if (source === src) source = null;
    if (encoder === enc) encoder = null;
    if (!stopping) handleEncoderClose();
  });

  emit("status", { recording: true, joined, mediaTime: 0 });
}

async function waitForExport() {
  const current = exportPromise;
  if (!current) return;
  try { await current; } catch {}
}

async function handleEncoderClose() {
  if (restarting || stopping) return;
  restarting = true;
  try {
    emit("status", { recording: false, joined, mediaTime: 0 });
    if (pending) await maybeExport(true);
    if (pending) {
      await waitForExport();
      if (pending) await maybeExport(true);
    }
    await waitForExport();
    cleanupSegments(true);
    if (pending) {
      emit("clip-failed", { error: "Recorder restarted before the clip was ready.", reason: pending.reason });
      pending = null;
    }
    mediaTime = 0;
    lastFrameAt = 0;
  } finally {
    restarting = false;
    if (!stopping) setTimeout(record, 15000);
  }
}

function cleanupSegments(force = false) {
  const rows = readManifest();
  const protectedFiles = new Set(exportingFiles);
  if (pending) {
    for (const row of rows) {
      if (row.end > pending.start - 6) protectedFiles.add(row.file);
    }
  }

  if (force) {
    for (const file of listSegments()) {
      if (!protectedFiles.has(file)) safeUnlink(file);
    }
    return;
  }

  const keepSeconds = Math.max(60, settings.preRollSec + settings.postRollSec + 30);
  const cutoff = mediaTime - keepSeconds;
  for (const row of rows) {
    if (row.end < cutoff && !protectedFiles.has(row.file)) safeUnlink(row.file);
  }

  const known = new Set(rows.map((row) => row.file));
  for (const file of listSegments()) {
    if (known.has(file) || protectedFiles.has(file)) continue;
    try {
      const stat = fs.statSync(path.join(temp, file));
      if (Date.now() - stat.mtimeMs > 300000) safeUnlink(file);
    } catch {}
  }
}

function requestClip({ reason, trigger = "manual", bypassCooldown = false, allowNoChat = false, meta = {} }) {
  if (stopping || restarting || pending || exporting) return false;
  if (!allowNoChat && !joined) return false;
  if (!Number.isFinite(mediaTime) || mediaTime < 3) return false;
  if (!lastFrameAt || Date.now() - lastFrameAt > 8000) return false;

  const now = Date.now();
  if (trigger === "command" && !bypassCooldown && now - lastCommand < settings.commandCooldownMs) return false;
  if ((trigger === "auto" || trigger === "raid") && !bypassCooldown && now - lastAuto < settings.autoCooldownMs) return false;
  if (trigger === "command") lastCommand = now;
  if (trigger === "auto" || trigger === "raid") { lastAuto = now; lastAutoTrigger = trigger; }

  const start = Math.max(0, mediaTime - settings.preRollSec);
  const end = mediaTime + settings.postRollSec;
  pending = {
    id: randomUUID(),
    windowId: meta.windowId || null,
    center: mediaTime,
    start,
    end,
    reason: cleanText(reason) || "Highlight",
    trigger,
    score: round(meta.score),
    participants: Number.isFinite(meta.participants) ? meta.participants : viewers.size,
    reactions: Number.isFinite(meta.reactions) ? meta.reactions : reactors.size,
    messages: Number.isFinite(meta.messages) ? meta.messages : messageCount,
    baseline: Number.isFinite(meta.baseline) ? meta.baseline : null,
    threshold: Number.isFinite(meta.threshold) ? meta.threshold : null,
    topEmotes: Array.isArray(meta.topEmotes) ? meta.topEmotes.slice(0, 3) : topEmotes(emoteCounts),
    detectedAt: new Date().toISOString()
  };
  emit("clip-requested", {
    clipId: pending.id,
    reason: pending.reason,
    trigger,
    center: round(mediaTime),
    participants: pending.participants
  });
  return true;
}

function writeJobSidecar(rawTarget, metadata) {
  try {
    return writeSidecar(rawTarget, metadata);
  } catch (error) {
    emit("error", { message: `Could not write clip metadata: ${error.message}` });
    return null;
  }
}

function deleteLocalVideo(file) {
  if (!file) return true;
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return !fs.existsSync(file);
  } catch (error) {
    emit("error", { message: `Could not delete ${file}: ${error.message}` });
    return false;
  }
}

function finishClip({ localPath, provider, remotePath, webLink, deletedLocal, reframed, sidecar, metadata, queued = false }) {
  clipCount += 1;
  const resolvedProvider = provider || storageConfig.mode;
  const historyProvider = metadata && metadata.storage && metadata.storage.requestedProvider
    ? metadata.storage.requestedProvider
    : resolvedProvider;
  const status = queued ? "queued" : resolvedProvider === "local" ? "local" : "uploaded";
  try {
    jobStore.addHistory({
      id: metadata && metadata.id ? metadata.id : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      channel,
      createdAt: metadata && metadata.createdAt ? metadata.createdAt : new Date().toISOString(),
      reason: metadata && metadata.reason ? metadata.reason : "Highlight",
      provider: historyProvider,
      localPath: localPath || null,
      remotePath: remotePath || null,
      webLink: webLink || null,
      deletedLocal: Boolean(deletedLocal),
      status,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    emit("error", { message: `Could not update clip history: ${error.message}` });
  }
  emitHistory();
  if (feedbackSession && metadata) {
    feedbackSession.countClip();
    const participants = Number(metadata.participants) || 0;
    feedback.logClipCreated({
      clipId: metadata.id,
      sessionId: feedbackSession.sessionId,
      mode: "live",
      channel,
      path: localPath || null,
      signals: {
        windowId: metadata.windowId || null,
        detectedAt: metadata.detectedAt,
        profileVersion,
        chatters: participants,
        baseline: metadata.baseline ?? null,
        chatterJump: metadata.baseline ? round(participants / Math.max(1, metadata.baseline)) : null,
        reactionShare: participants ? round((Number(metadata.reactions) || 0) / participants) : null,
        messages: metadata.messages ?? null,
        topEmotes: metadata.topEmotes || [],
        emoteDiversity: Array.isArray(metadata.topEmotes) ? metadata.topEmotes.length : null,
        score: metadata.score ?? null,
        threshold: metadata.threshold ?? null,
        trigger: metadata.trigger || null,
        strong: metadata.trigger === "auto" ? true : null
      }
    });
  }
  emit("clip-saved", {
    path: localPath || null,
    provider: resolvedProvider,
    storageProvider: resolvedProvider,
    remotePath: remotePath || null,
    webLink: webLink || null,
    // Kept for the 2.x app while the 3.0 UI is rolled out.
    dropboxPath: resolvedProvider === "dropbox" ? (remotePath || null) : null,
    deletedLocal: Boolean(deletedLocal),
    reframed: Boolean(reframed),
    queued: Boolean(queued),
    sidecar: sidecar || null,
    metadata,
    count: clipCount
  });
}

function emitQueue() {
  emit("queue-updated", { items: jobStore.listQueue() });
}

function emitHistory() {
  emit("history-updated", { items: jobStore.listHistory() });
}

function queueUpload({ job, metadata, rawPath, verticalPath, provider, folder, status = "pending", lastError = "" }) {
  const existing = jobStore.listQueue().find((item) => item.id === job.id);
  const attempts = existing ? (existing.attempts || 0) : 0;
  const delay = Math.min(3600000, RETRY_BASE_MS * 2 ** Math.min(6, attempts));
  const item = {
    id: job.id,
    windowId: job.windowId || null,
    profileVersion,
    channel,
    provider,
    folder,
    rawPath,
    verticalPath,
    localPaths: [rawPath, verticalPath].filter(Boolean),
    metadata,
    deleteAfterUpload: storageConfig.deleteAfterUpload,
    keepLocalCopy: storageConfig.keepLocalCopy,
    keepRaw: storageConfig.keepRaw,
    attempts,
    status,
    lastError,
    nextRetryAt: status === "uploading" ? null : new Date(Date.now() + delay).toISOString(),
    createdAt: existing && existing.createdAt ? existing.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  jobStore.enqueue(item);
  emitQueue();
  return item;
}

function rescheduleQueue(item, error) {
  const attempts = (item.attempts || 0) + 1;
  const delay = Math.min(3600000, RETRY_BASE_MS * 2 ** Math.min(6, attempts));
  jobStore.update(item.id, {
    status: "pending",
    attempts,
    lastError: error && error.message ? error.message : String(error),
    nextRetryAt: new Date(Date.now() + delay).toISOString()
  });
  emitQueue();
}

async function processQueue() {
  if (queueBusy || stopping || exporting || pending) return;
  queueBusy = true;
  try {
    const item = jobStore.due()[0];
    if (!item) return;
    const primary = [item.verticalPath, item.rawPath].find((file) => file && fs.existsSync(file)) || null;
    if (!primary) {
      rescheduleQueue(item, new Error("Local clip files are missing."));
      return;
    }

    let provider;
    try {
      provider = createStorageProvider({ ...storageConfig, mode: item.provider, folder: item.folder });
    } catch (error) {
      rescheduleQueue(item, error);
      return;
    }

    jobStore.update(item.id, { status: "uploading", lastError: "" });
    emitQueue();

    let upload;
    try {
      upload = await provider.uploadClip(primary, { folder: item.folder, channel });
    } catch (error) {
      rescheduleQueue(item, error);
      emit("error", { message: `${storageLabel(item.provider)} retry failed: ${error.message}` });
      return;
    }

    const remotePath = upload.path || upload.remotePath || "";
    const metadata = item.metadata || {};
    metadata.storage = {
      provider: item.provider,
      path: remotePath,
      remotePath,
      fileId: upload.fileId || "",
      size: upload.size,
      webLink: upload.webLink || "",
      uploadedAt: new Date().toISOString()
    };
    let sidecar = item.rawPath ? writeJobSidecar(item.rawPath, metadata) : null;
    emit("clip-uploaded", {
      provider: item.provider,
      remotePath,
      fileId: upload.fileId || "",
      bytes: upload.size,
      webLink: upload.webLink || "",
      localPath: primary,
      clipId: item.id || null,
      queued: true
    });

    const attempted = [...new Set([item.rawPath, item.verticalPath, primary].filter(Boolean))];
    const keepLocal = item.keepLocalCopy || !item.deleteAfterUpload;
    const deleted = [];
    let remaining = primary;
    if (keepLocal) {
      if (item.verticalPath && !item.keepRaw) {
        if (deleteLocalVideo(item.rawPath)) deleted.push(item.rawPath);
      }
      remaining = primary;
    } else {
      for (const file of attempted) {
        if (deleteLocalVideo(file)) deleted.push(file);
      }
      remaining = [primary, item.rawPath, item.verticalPath]
        .filter(Boolean)
        .find((file) => fs.existsSync(file)) || null;
    }

    const deletedLocal = !remaining;
    metadata.deletedLocal = deletedLocal;
    metadata.deletedAt = deletedLocal ? new Date().toISOString() : null;
    metadata.deletedFiles = deleted;
    sidecar = item.rawPath ? writeJobSidecar(item.rawPath, metadata) : sidecar;
    if (deleted.length) {
      emit("clip-deleted", {
        provider: item.provider,
        paths: deleted,
        complete: deletedLocal,
        keptLocal: keepLocal,
        sidecar,
        queued: true
      });
    }

    jobStore.addHistory({
      id: item.id,
      channel,
      createdAt: item.createdAt,
      reason: metadata.reason || "Highlight",
      provider: item.provider,
      localPath: remaining,
      remotePath,
      webLink: upload.webLink || "",
      deletedLocal,
      status: "uploaded",
      updatedAt: new Date().toISOString()
    });
    jobStore.remove(item.id);
    emitQueue();
    emitHistory();
  } catch (error) {
    emit("error", { message: `Queue: ${error.message}` });
  } finally {
    queueBusy = false;
  }
}

async function runPipeline(job, plan, rawTarget) {
  const metadata = {
    version: 3,
    platform: streamSource.platform,
    sourceUrl: streamSource.url,
    id: job.id,
    windowId: job.windowId || null,
    profileVersion,
    channel,
    createdAt: new Date().toISOString(),
    detectedAt: job.detectedAt,
    source: "streamlink",
    trigger: job.trigger,
    reason: job.reason,
    durationSec: round(plan.duration),
    preRollSec: round(Math.max(0, job.center - plan.start)),
    postRollSec: round(Math.max(0, plan.end - job.center)),
    score: job.score,
    participants: job.participants,
    reactions: job.reactions,
    messages: job.messages,
    topEmotes: job.topEmotes,
    baseline: job.baseline ?? null,
    threshold: job.threshold ?? null,
    truncated: plan.truncated,
    reframed: false,
    raw: { file: path.basename(rawTarget) },
    vertical: null,
    storage: null,
    deletedLocal: false,
    file: path.basename(rawTarget)
  };

  const files = plan.rows.map((row) => path.join(temp, row.file));
  let result = await exportClip({ files, offset: plan.offset, duration: plan.duration, target: rawTarget, encoder: reframeConfig.encoder, bitrate: reframeConfig.bitrate, priority: reframeConfig.priority });
  if (!result.ok) {
    emit("error", { message: `Export failed, retrying: ${result.error}` });
    result = await exportClip({ files, offset: plan.offset, duration: plan.duration, target: rawTarget, encoder: reframeConfig.encoder, bitrate: reframeConfig.bitrate, priority: reframeConfig.priority });
  }
  if (!result.ok) {
    emit("clip-failed", { error: result.error, reason: job.reason });
    return;
  }

  exportingFiles = new Set();
  let sidecar = writeJobSidecar(rawTarget, metadata);
  emit("clip-exported", { path: rawTarget, sidecar, metadata });

  let verticalTarget = null;
  let reframed = false;
  if (reframeConfig.enabled) {
    const base = path.basename(rawTarget, ".mp4");
    verticalTarget = uniquePath(output, `${base}-9x16.mp4`);
    // Free plan: after the weekly allowance, clips carry a watermark.
    const tier = freeTier.status({ dir: jobStore.stateDir });
    const watermark = tier.watermark ? freeTier.prepareWatermark() : null;
    if (tier.watermark && !watermark) emit("error", { message: "Could not prepare the free-plan watermark. Saving this clip without it." });
    const reframe = await reframeClip({
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
    });
    if (!reframe.ok) {
      metadata.reframed = false;
      metadata.reframeError = reframe.error;
      sidecar = writeJobSidecar(rawTarget, metadata);
      emit("error", { message: `Reframe failed: ${reframe.error}. Keeping the landscape clip.` });
      finishClip({
        localPath: rawTarget,
        provider: "local",
        remotePath: null,
        deletedLocal: false,
        reframed: false,
        sidecar,
        metadata
      });
      return;
    }
    reframed = true;
    metadata.reframed = true;
    metadata.watermarked = Boolean(watermark);
    if (tier.plan === "free" && !tier.watermark) freeTier.recordClip({ dir: jobStore.stateDir });
    if (tier.plan === "free") emit("free-tier", freeTier.status({ dir: jobStore.stateDir }));
    metadata.vertical = {
      file: path.basename(verticalTarget),
      width: reframeConfig.width,
      height: reframeConfig.height
    };
    metadata.file = path.basename(verticalTarget);
    sidecar = writeJobSidecar(rawTarget, metadata);
    emit("clip-reframed", {
      path: verticalTarget,
      width: reframeConfig.width,
      height: reframeConfig.height,
      sidecar
    });
  }

  const primary = verticalTarget || rawTarget;
  const cleanupRaw = () => {
    if (!verticalTarget || storageConfig.keepRaw) return [];
    if (!fs.existsSync(rawTarget)) return [];
    return deleteLocalVideo(rawTarget) ? [rawTarget] : [];
  };
  const requestedProvider = storageConfig.mode;

  if (requestedProvider === "local") {
    const deletedFiles = cleanupRaw();
    metadata.storage = { provider: "local", path: primary, file: path.basename(primary) };
    metadata.deletedFiles = deletedFiles;
    metadata.deletedLocal = false;
    sidecar = writeJobSidecar(rawTarget, metadata);
    finishClip({
      localPath: primary,
      provider: "local",
      remotePath: null,
      deletedLocal: false,
      reframed,
      sidecar,
      metadata
    });
    return;
  }

  if (!storageProvider) {
    const message = storageProviderError || `${storageLabel(requestedProvider)} is not configured.`;
    metadata.storage = { provider: "local", path: primary, requestedProvider, error: message };
    metadata.storageError = message;
    sidecar = writeJobSidecar(rawTarget, metadata);
    queueUpload({
      job,
      metadata,
      rawPath: rawTarget,
      verticalPath: verticalTarget,
      provider: requestedProvider,
      folder: storageConfig.folder,
      status: "pending",
      lastError: message
    });
    emit("error", { message: `${message} Keeping the local clip and queuing the upload.` });
    finishClip({
      localPath: primary,
      provider: "local",
      remotePath: null,
      deletedLocal: false,
      reframed,
      sidecar,
      metadata,
      queued: true
    });
    return;
  }

  const provider = storageProvider.provider;
  const remoteFolder = storageConfig.folder;
  const queuedItem = queueUpload({
    job,
    metadata,
    rawPath: rawTarget,
    verticalPath: verticalTarget,
    provider,
    folder: remoteFolder,
    status: "uploading"
  });
  emit("clip-uploading", { provider, path: primary, folder: remoteFolder, channel });
  let upload;
  try {
    upload = await storageProvider.uploadClip(primary, { folder: remoteFolder, channel });
  } catch (error) {
    metadata.storage = { provider, path: null, requestedProvider, error: error.message };
    metadata.storageError = error.message;
    sidecar = writeJobSidecar(rawTarget, metadata);
    rescheduleQueue(queuedItem, error);
    emit("error", { message: `${storageLabel(provider)} upload failed: ${error.message}. Keeping local clips and queuing a retry.` });
    finishClip({
      localPath: primary,
      provider: "local",
      remotePath: null,
      deletedLocal: false,
      reframed,
      sidecar,
      metadata,
      queued: true
    });
    return;
  }

  const remotePath = upload.path || upload.remotePath || "";
  metadata.storage = {
    provider,
    path: remotePath,
    remotePath,
    fileId: upload.fileId || "",
    size: upload.size,
    webLink: upload.webLink || "",
    uploadedAt: new Date().toISOString()
  };
  sidecar = writeJobSidecar(rawTarget, metadata);
  jobStore.remove(job.id);
  emitQueue();
  emit("clip-uploaded", {
    provider,
    remotePath,
    fileId: upload.fileId || "",
    bytes: upload.size,
    webLink: upload.webLink || "",
    localPath: primary
  });

  const keepLocal = storageConfig.keepLocalCopy || !storageConfig.deleteAfterUpload;
  if (keepLocal) {
    const deletedFiles = cleanupRaw();
    metadata.deletedFiles = deletedFiles;
    metadata.deletedLocal = false;
    metadata.deletedAt = null;
    sidecar = writeJobSidecar(rawTarget, metadata);
    if (deletedFiles.length) {
      emit("clip-deleted", { provider, paths: deletedFiles, complete: false, keptLocal: true, sidecar });
    }
    finishClip({
      localPath: primary,
      provider,
      remotePath,
      webLink: upload.webLink || "",
      deletedLocal: false,
      reframed,
      sidecar,
      metadata
    });
    return;
  }

  const attempted = [...new Set([rawTarget, verticalTarget].filter(Boolean))];
  const deleted = [];
  for (const file of attempted) {
    if (deleteLocalVideo(file)) deleted.push(file);
  }
  const remaining = [primary, rawTarget, verticalTarget]
    .filter(Boolean)
    .find((file) => fs.existsSync(file)) || null;
  metadata.deletedLocal = !remaining;
  metadata.deletedAt = remaining ? null : new Date().toISOString();
  metadata.deletedFiles = deleted;
  sidecar = writeJobSidecar(rawTarget, metadata);
  emit("clip-deleted", { provider, paths: deleted, complete: !remaining, keptLocal: false, sidecar });
  finishClip({
    localPath: remaining,
    provider,
    remotePath,
    webLink: upload.webLink || "",
    deletedLocal: !remaining,
    reframed,
    sidecar,
    metadata
  });
}

async function maybeExport(force = false) {
  if (!pending || exporting) return;
  const rows = readManifest();
  const plan = planClip(rows, pending.start, pending.end, { gapTolerance: 6, minDuration: 3 });

  if (!plan.rows.length) {
    if (force) {
      emit("clip-failed", { error: "No segments available for this highlight.", reason: pending.reason });
      pending = null;
    }
    return;
  }

  const missing = plan.rows.filter((row) => !fs.existsSync(path.join(temp, row.file)));
  if (missing.length) {
    emit("clip-failed", { error: `Missing ${missing.length} segment(s).`, reason: pending.reason });
    pending = null;
    return;
  }

  if (!plan.usable) {
    if (force) {
      emit("clip-failed", { error: "Not enough contiguous video for this highlight.", reason: pending.reason });
      pending = null;
    }
    return;
  }

  if (!plan.ready && !force) return;

  const job = pending;
  pending = null;
  exporting = job;
  exportingFiles = new Set(plan.rows.map((row) => row.file));
  const rawTarget = uniquePath(output, `${channel}-${stamp(job.detectedAt)}-${job.trigger}.mp4`);
  emit("status", { exporting: true, target: rawTarget });

  const promise = (async () => {
    try {
      await runPipeline(job, plan, rawTarget);
    } catch (error) {
      emit("clip-failed", { error: error.message, reason: job.reason });
    } finally {
      exporting = null;
      exportingFiles = new Set();
    }
  })();

  exportPromise = promise;
  try {
    await promise;
  } finally {
    if (exportPromise === promise) exportPromise = null;
  }
}

async function tick() {
  if (tickBusy || stopping) return;
  tickBusy = true;
  try {
    cleanupSegments();
    if (pending) maybeExport().catch(error => emit("error", { message: `Exporter: ${error.message}` }));
    if (pending && Date.now() - lastFrameAt > 15000) {
      // The stream stalled after the trigger; save what exists instead of blocking forever.
      maybeExport(true).catch(error => emit("error", { message: `Exporter: ${error.message}` }));
    }

    if (smokeChat && !smokeSpikeSent && mediaTime >= settings.preRollSec && paceHistory.length >= settings.warmupWindows) {
      smokeSpikeSent = true;
      for (let i = 0; i < 12; i += 1) {
        handleChatLine(`:smoke_user${i}!user@localhost PRIVMSG #${channel} :Pog that was insane`);
      }
    }

    const windowParticipants = viewers.size;
    const windowReactions = reactors.size;
    const windowMessages = messageCount;
    const time = Date.now();
    const windowId = randomUUID();
    const previousLastAuto = lastAuto;
    const previousAutoTrigger = lastAutoTrigger;
    const eligible = joined && Boolean(encoder) && !pending && !exporting && mediaTime >= 3 && time - lastFrameAt < 8000;
    const suppression = !joined ? "chat-disconnected" : !encoder ? "recorder-offline" : time - lastFrameAt >= 8000 ? "stale-video" : mediaTime < 3 ? "buffering" : pending ? "clip-pending" : exporting ? "exporting" : time - lastAuto < settings.autoCooldownMs ? "cooldown" : null;
    const reactionResult = evaluateReaction({
        history: paceHistory,
        participants: windowParticipants,
        reactions: windowReactions,
        settings
      });
    let accepted = false;
    if (eligible && reactionResult.trigger) {
        const top = topEmotes(emoteCounts);
        const reason = `Chat spike · ${windowParticipants} viewers${top.length ? ` · ${top[0].name} ×${top[0].count}` : ""}`;
        accepted = requestClip({
          reason,
          trigger: "auto",
          meta: {
            windowId,
            score: reactionResult.score,
            participants: windowParticipants,
            reactions: windowReactions,
            messages: windowMessages,
            topEmotes: top,
            baseline: reactionResult.median,
            threshold: reactionResult.threshold
          }
        });
    }

    lastWindow = { kind: "window", id: windowId, at: new Date(time).toISOString(), time,
      mediaTime: round(mediaTime), joined, recording: Boolean(encoder),
      frameAgeMs: lastFrameAt ? time - lastFrameAt : 999999, participants: windowParticipants,
      reactions: windowReactions, messages: windowMessages, eligible, accepted,
      suppression, reset: paceHistory.length === 0, lastAuto: previousLastAuto,
      lastAutoTrigger: previousAutoTrigger, result: reactionResult, profileVersion };
    monitor?.record(lastWindow);

    if (joined) {
      paceHistory.push(windowParticipants);
      if (paceHistory.length > settings.historyLimit) paceHistory.shift();
    }
    const windowEmotes = topEmotes(emoteCounts);
    viewers.clear();
    reactors.clear();
    emoteCounts.clear();
    messageCount = 0;

    emit("status", {
      recording: Boolean(encoder),
      joined,
      mediaTime: round(mediaTime),
      participants: windowParticipants,
      reactions: windowReactions,
      messages: windowMessages,
      history: paceHistory.length,
      score: reactionResult ? reactionResult.score : 0,
      threshold: reactionResult ? reactionResult.threshold : 0,
      median: reactionResult ? reactionResult.median : 0,
      reactionFloor: reactionResult ? reactionResult.reactionFloor : 0,
      trigger: reactionResult ? reactionResult.trigger : false,
      reasons: reactionResult ? reactionResult.reasons : [],
      topEmotes: windowEmotes,
      pending: Boolean(pending),
      exporting: Boolean(exporting),
      clips: clipCount
    });
  } catch (error) {
    emit("error", { message: `Sampler: ${error.message}` });
  } finally {
    tickBusy = false;
  }
}

function sendChat(text) {
  try {
    if (chat && chat.readyState === WebSocket.OPEN) chat.send(text);
  } catch {}
}

async function fetchEmoteSet(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`7TV returned ${response.status}`);
  const data = await response.json();
  return (data.emote_set || data).emotes || [];
}

async function getEmotes(id) {
  const results = await Promise.allSettled([
    fetchEmoteSet("https://7tv.io/v3/emote-sets/global"),
    fetchEmoteSet("https://7tv.io/v3/users/twitch/" + id)
  ]);
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const emote of result.value) if (emote && emote.name) emotes.add(emote.name);
  }
  const channelSet = results[1];
  emit("status", {
    emotes: emotes.size,
    channelEmotes: channelSet.status === "fulfilled" ? channelSet.value.length : null
  });
}

function handleChatLine(raw) {
  if (!raw || stopping) return;
  const event = parseChatLine(raw);

  if (event.type === "ping") {
    sendChat("PONG :tmi.twitch.tv");
    return;
  }
  if (event.type === "ready") {
    sendChat("JOIN #" + channel);
    return;
  }
  if (event.type === "joined" || event.type === "join") {
    if (!event.channel || event.channel === channel) joined = true;
    return;
  }

  const id = roomId(event.tags);
  if (id && id !== room) {
    room = id;
    getEmotes(id).catch((error) => emit("error", { message: `7TV: ${error.message}` }));
  }

  handleChatEvent(event);
}

function handleChatEvent(event) {
  if (stopping) return;
  if (event.type === "chat" && event.channel === channel) {
    joined = true;
    viewers.add(event.nick);
    messageCount += 1;
    if (isReaction(event.text, emotes)) reactors.add(event.nick);
    collectEmotes(event.text, emotes, emoteCounts);
    if (settings.clipOnCommand && isClipCommand(event.text) && isPrivileged(event.tags, event.nick, channel)) {
      requestClip({
        reason: `Chat command by @${event.nick}`,
        trigger: "command",
        meta: {
          participants: viewers.size,
          reactions: reactors.size,
          messages: messageCount,
          topEmotes: topEmotes(emoteCounts)
        }
      });
    }
  } else if (event.type === "usernotice" && event.channel === channel && event.raid && settings.clipOnRaid) {
    requestClip({
      reason: `Raid · ${event.raid.viewers} viewers`,
      trigger: "raid",
      meta: {
        participants: viewers.size,
        reactions: reactors.size,
        messages: messageCount,
        topEmotes: topEmotes(emoteCounts)
      }
    });
  }
}

function connect() {
  if (stopping) return;
  joined = false;
  if (streamSource.platform === "kick") {
    let lastChatMessage = "";
    chat = connectKickChat({ slug: streamSource.slug, relay: kickRelay,
      onMessage: event => {
        // Keep the dictionary bounded across long sessions.
        for (const name of event.emotes) { if (emotes.size < 10000) emotes.add(name); }
        handleChatEvent(event);
      },
      onState: (connected, message) => {
        if (stopping) return;
        if (!connected) { paceHistory = []; viewers.clear(); reactors.clear(); emoteCounts.clear(); messageCount = 0; }
        if (joined !== connected || message !== lastChatMessage) emit(connected ? "status" : "error", { chatConnected: connected, joined: connected, recording: Boolean(encoder), message });
        lastChatMessage = message;
        joined = connected;
      }
    });
    return;
  }
  chat = new WebSocket("wss://irc-ws.chat.twitch.tv");
  chat.onopen = () => {
    sendChat("CAP REQ :twitch.tv/tags twitch.tv/commands");
    sendChat("PASS SCHMOOPIIE");
    sendChat("NICK justinfan" + Math.floor(100000 + Math.random() * 900000));
  };
  chat.onmessage = ({ data }) => {
    for (const line of String(data).split("\r\n")) handleChatLine(line);
  };
  chat.onerror = () => {};
  chat.onclose = () => {
    joined = false;
    paceHistory = [];
    viewers.clear();
    reactors.clear();
    emoteCounts.clear();
    messageCount = 0;
    if (!stopping) setTimeout(connect, 5000);
  };
}

function start() {
  if (!preflight()) return;
  try {
    const profile = monitorPolicy.loadProfile(jobStore.stateDir, channel);
    Object.assign(settings, profile.settings);
    profileVersion = profile.version;
  } catch (error) { emit("error", { message: `Using default detection: ${error.message}` }); }
  feedbackSession = feedback.startSession({ mode: "live", channel, extra: { platform: streamSource.platform } });
  monitor = startMonitor({ dir: jobStore.stateDir, channel, sessionId: feedbackSession.sessionId, settings,
    onStatus: message => emit(message.type, message) });
  emit("ready", {
    channel,
    output,
    temp,
    version: VERSION,
    sessionId: feedbackSession.sessionId,
    profileVersion,
    settings: {
      preRollSec: settings.preRollSec,
      postRollSec: settings.postRollSec,
      autoCooldownMs: settings.autoCooldownMs,
      sensitivity: settings.sensitivity
    },
    reframe: reframeConfig,
    storage: {
      mode: storageConfig.mode,
      label: storageLabel(storageConfig.mode),
      configured: Boolean(storageProvider),
      folder: storageConfig.folder,
      deleteAfterUpload: storageConfig.deleteAfterUpload,
      keepLocalCopy: storageConfig.keepLocalCopy,
      keepRaw: storageConfig.keepRaw,
      dropboxConfigured: storageConfig.dropbox.configured,
      googleDriveConfigured: storageConfig.googleDrive.configured
    },
    // Kept for the 2.x app while the 3.0 UI is rolled out.
    dropbox: {
      enabled: storageConfig.dropbox.enabled,
      configured: storageConfig.mode === "dropbox" && Boolean(storageProvider),
      folder: storageConfig.dropbox.folder,
      deleteAfterUpload: storageConfig.deleteAfterUpload
    },
    configPath: configResult.path,
    stateDir: jobStore.stateDir
  });
  if (configResult.error) emit("error", { message: `Config: ${configResult.error}` });
  if (storageConfig.invalidMode) emit("error", { message: `Unknown storage mode "${storageConfig.invalidMode}"; using local storage.` });
  if (storageProviderError) emit("error", { message: `Storage: ${storageProviderError}` });
  jobStore.recover();
  emitQueue();
  emitHistory();
  if (freeTier.currentPlan() === "free") emit("free-tier", freeTier.status({ dir: jobStore.stateDir }));
  if (jobStore.disabled) emit("error", { message: `Could not write the upload queue at ${jobStore.stateDir}; retries will not survive restart.` });
  record();
  if (smokeChat) {
    // Exercise chat parsing and scoring without relying on Twitch in CI.
    settings.warmupWindows = 3;
    settings.sampleMs = 1000;
    handleChatLine(`:tmi.twitch.tv 366 smoke_user #${channel} :End of /NAMES list`);
  } else {
    connect();
  }
  ticker = setInterval(tick, settings.sampleMs);
  emoteTimer = setInterval(() => {
    if (room) getEmotes(room).catch((error) => emit("error", { message: `7TV: ${error.message}` }));
  }, 900000);
  setTimeout(processQueue, 5000);
  queueTimer = setInterval(processQueue, QUEUE_INTERVAL_MS);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("SIGUSR2", () => {
  const requested = requestClip({ reason: "Manual highlight", trigger: "manual", bypassCooldown: true, allowNoChat: true });
  if (!requested) emit("error", { message: "Highlight not ready yet. Wait for the buffer to fill or for the current export to finish." });
});
process.on("SIGUSR1", () => {
  if (!feedbackSession || !lastWindow) return;
  feedback.logEvent("missed-moment", { channel, sessionId: feedbackSession.sessionId,
    mediaTime: lastWindow.mediaTime, windowId: lastWindow.id }, { dir: jobStore.stateDir });
  emit("missed-moment", { message: "Marked this moment for review. No extra clip was created." });
});
// Windows has no SIGUSR1/2, so a host app can send newline-delimited commands
// on stdin instead (CLIPSPIKE_COMMANDS=1): "save", "missed", "stop".
if (process.env.CLIPSPIKE_COMMANDS === "1") {
  const commands = {
    save: () => process.emit("SIGUSR2"),
    missed: () => process.emit("SIGUSR1"),
    stop: () => shutdown(0)
  };
  readline.createInterface({ input: process.stdin }).on("line", (line) => {
    const handler = commands[String(line).trim().toLowerCase()];
    if (handler) handler();
  }).on("close", () => { if (!stopping) shutdown(0); });
}

function recordCrash(kind, error) {
  const file = writeCrashReport({
    dir: jobStore.stateDir,
    kind,
    error,
    version: require("./package.json").version,
    context: { channel: typeof channel === "string" ? channel : "", queued: (() => { try { return jobStore.listQueue().length; } catch { return -1; } })() }
  });
  return file;
}
process.on("uncaughtException", (error) => {
  const file = recordCrash("uncaughtException", error);
  emit("fatal", { message: (error && (error.stack || error.message)) || String(error), crashReport: file || undefined });
  shutdown(1);
});
process.on("unhandledRejection", (error) => {
  const file = recordCrash("unhandledRejection", error);
  emit("fatal", { message: error && error.stack ? error.stack : String(error), crashReport: file || undefined });
  shutdown(1);
});
process.stdout.on("error", () => {});

start();
