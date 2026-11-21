"use strict";

const $ = (id) => document.getElementById(id);
const CONFIG = globalThis.HDConfig;
const IRC = globalThis.HDIrc;
const REACT = globalThis.HDReactions;
const STORE = globalThis.HDStore;

if (!CONFIG || !IRC || !REACT || !STORE) {
  const status = document.getElementById("status");
  if (status) status.textContent = "ClipSpike could not load its shared modules. Refresh the page.";
  throw new Error("ClipSpike modules failed to load.");
}

const field = $("channel");
const captureButton = $("capture");
const manualButton = $("manual");
const statusLine = $("status");
const activity = $("activity");
const emotesStatus = $("emotes");
const feed = $("feed");
const libraryGrid = $("library");
const empty = $("empty");
const toastNode = $("toast");
const sparkline = $("sparkline");
const sparklineLabel = $("sparkline-label");

let settings = CONFIG.mergeSettings(CONFIG.settingsFor("web"), CONFIG.loadSettings(storage()));
let socket = null;
let stream = null;
let ticker = null;
let retry = null;
let emoteTimer = null;
let joinTimeout = null;
let channel = "";
let joined = false;
let roomId = null;
let generation = 0;
let emotes = new Map();
let recorders = [];
let pending = null;
let tailTimer = null;
let lastAuto = 0;
let lastCommand = 0;
let paceHistory = [];
let viewers = new Set();
let reactors = new Set();
let emoteCounts = new Map();
let messageCount = 0;
let mimeType = "";
let stats = { audio: false, crop: false };
let clips = [];
let clipUrls = new Map();
let storeReady = true;
let persistRequested = false;
let toastTimer = null;
let lastSparkValues = [];
let lastSparkThreshold = 0;

function storage() {
  try { return window.localStorage; } catch { return null; }
}

function newId() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
  } catch {}
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fmtBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function fmtWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  try {
    return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return date.toLocaleString();
  }
}

function stamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const pad = (number) => String(number).padStart(2, "0");
  return `${safe.getFullYear()}${pad(safe.getMonth() + 1)}${pad(safe.getDate())}-${pad(safe.getHours())}${pad(safe.getMinutes())}${pad(safe.getSeconds())}`;
}

function filenameFor(record) {
  const extension = String(record.mime || "").includes("mp4") ? "mp4" : "webm";
  const name = String(record.channel || channel || "highlight").replace(/[^a-z0-9_-]/gi, "");
  const trigger = String(record.trigger || "highlight").replace(/[^a-z-]/gi, "") || "highlight";
  return `${name}-${stamp(record.createdAt)}-${trigger}.${extension}`;
}

function setStatus(text, tone = "") {
  statusLine.textContent = text;
  if (tone) statusLine.dataset.tone = tone;
  else statusLine.removeAttribute("data-tone");
}

function setChip(id, text, tone = "") {
  const node = $(id);
  node.textContent = text;
  if (tone) node.dataset.tone = tone;
  else node.removeAttribute("data-tone");
}

function setStorageNote(text, tone = "") {
  const node = $("storage-note");
  node.textContent = text;
  if (tone) node.dataset.tone = tone;
  else node.removeAttribute("data-tone");
}

function toast(message, tone = "info") {
  toastNode.textContent = message;
  if (tone && tone !== "info") toastNode.dataset.tone = tone;
  else toastNode.removeAttribute("data-tone");
  toastNode.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastNode.classList.remove("show"), 4200);
}

function updateBufferHealth() {
  const now = Date.now();
  const seconds = recorders.reduce((total, recorder) => total + Math.min(settings.bufferSlotMs, Math.max(0, now - recorder.started)), 0) / 1000;
  const text = stream ? `Buffer ${Math.round(seconds)}s` : "Buffer 0s";
  const tone = stream && seconds >= settings.minBufferMs / 1000 ? "good" : "";
  setChip("health-buffer", text, tone);
}

function updateSteps() {
  for (const item of document.querySelectorAll("#steps li")) {
    const step = item.dataset.step;
    const done =
      (step === "play" && Boolean(stream)) ||
      (step === "capture" && Boolean(stream)) ||
      (step === "tab" && Boolean(stream) && stats.audio) ||
      (step === "crop" && Boolean(stream) && stats.crop);
    item.classList.toggle("done", done);
  }
}

function updateHealth() {
  setChip("health-chat", joined ? `#${channel}` : "Chat offline", joined ? "good" : "");
  captureButton.classList.toggle("is-live", Boolean(stream));
  if (!stream) {
    setChip("health-audio", "No audio", "");
    setChip("health-crop", "No capture", "");
  } else {
    setChip("health-audio", stats.audio ? "Audio on" : "No audio", stats.audio ? "good" : "warn");
    setChip("health-crop", stats.crop ? "Player cropped" : "Full tab", stats.crop ? "good" : "warn");
  }
  updateBufferHealth();
  updateSteps();
}

function syncSettingsOutputs() {
  $("sensitivity-value").value = settings.sensitivity.toFixed(1);
  $("cooldown-value").value = `${Math.round(settings.autoCooldownMs / 1000)}s`;
  $("postroll-value").value = `${Math.round(settings.postRollSec)}s`;
  $("minparticipants-value").value = String(Math.round(settings.minParticipants));
}

function applySettingsToForm() {
  $("sensitivity").value = String(settings.sensitivity);
  $("cooldown").value = String(Math.round(settings.autoCooldownMs / 1000));
  $("postroll").value = String(Math.round(settings.postRollSec));
  $("minparticipants").value = String(Math.round(settings.minParticipants));
  syncSettingsOutputs();
}

function saveSettingsFromForm() {
  settings = CONFIG.mergeSettings(CONFIG.settingsFor("web"), settings, {
    sensitivity: Number($("sensitivity").value),
    autoCooldownMs: Number($("cooldown").value) * 1000,
    postRollSec: Number($("postroll").value),
    minParticipants: Number($("minparticipants").value)
  });
  CONFIG.saveSettings(settings, storage());
  syncSettingsOutputs();
}

function drawSparkline(values, threshold) {
  const rect = sparkline.getBoundingClientRect();
  if (!rect.width) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(sparkline.getBoundingClientRect().height || 64));
  if (sparkline.width !== Math.floor(width * dpr) || sparkline.height !== Math.floor(height * dpr)) {
    sparkline.width = Math.floor(width * dpr);
    sparkline.height = Math.floor(height * dpr);
  }
  const context = sparkline.getContext("2d");
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  context.strokeStyle = "#27272A";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, height - 0.5);
  context.lineTo(width, height - 0.5);
  context.stroke();

  if (!values.length) return;
  const shown = values.slice(-settings.recentWindows);
  const maximum = Math.max(...shown, threshold, 1);
  const gap = shown.length > 48 ? 0 : 1;
  const barWidth = Math.max(1, (width - gap * Math.max(0, shown.length - 1)) / shown.length);
  const plot = Math.max(1, height - 2);

  if (threshold > 0) {
    const y = Math.round(height - (threshold / maximum) * plot) + 0.5;
    context.strokeStyle = "#3F3F46";
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  shown.forEach((value, index) => {
    const amount = Math.min(Math.max(value, 0), maximum) / maximum;
    const bar = Math.max(amount > 0 ? 1 : 0, Math.round(amount * plot));
    context.fillStyle = threshold > 0 && value >= threshold ? "#10B981" : "#3F3F46";
    context.fillRect(index * (barWidth + gap), height - bar, barWidth, bar);
  });
}

function updateSparkline(evaluation, current) {
  const values = [...paceHistory, current].slice(-settings.recentWindows);
  const threshold = evaluation ? evaluation.threshold : 0;
  lastSparkValues = values;
  lastSparkThreshold = threshold;
  drawSparkline(values, threshold);
  if (!joined) {
    sparklineLabel.textContent = "Chat offline";
  } else if (paceHistory.length < settings.warmupWindows) {
    sparklineLabel.textContent = `Warming up ${paceHistory.length}/${settings.warmupWindows}`;
  } else {
    sparklineLabel.textContent = `${current} chatters · thr ${threshold}`;
  }
}

function showMessage(sender, message) {
  const row = document.createElement("li");
  const user = document.createElement("strong");
  user.textContent = sender + " ";
  row.append(user);
  for (const word of String(message).split(/(\s+)/)) {
    if (!emotes.has(word)) {
      row.append(word);
      continue;
    }
    const image = document.createElement("img");
    image.alt = image.title = word;
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.src = "https://cdn.7tv.app/emote/" + encodeURIComponent(emotes.get(word)) + "/2x.webp";
    row.append(image);
  }
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 30;
  feed.append(row);
  if (feed.children.length > 120) feed.firstElementChild.remove();
  if (atBottom) feed.scrollTop = feed.scrollHeight;
}

async function fetchEmoteSet(url) {
  const options = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? { signal: AbortSignal.timeout(12000) }
    : {};
  const response = await fetch(url, options);
  if (response.status === 404) return [];
  if (!response.ok) throw new Error("7TV unavailable");
  const data = await response.json();
  return (data.emote_set || data).emotes || [];
}

async function loadEmotes(id) {
  roomId = id;
  const version = generation;
  const results = await Promise.allSettled([
    fetchEmoteSet("https://7tv.io/v3/emote-sets/global"),
    fetchEmoteSet("https://7tv.io/v3/users/twitch/" + id)
  ]);
  if (generation !== version) return;
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const emote of result.value) if (emote && emote.name) emotes.set(emote.name, emote.id);
  }
  const channelSet = results[1];
  emotesStatus.textContent = channelSet.status === "fulfilled"
    ? `${channelSet.value.length} channel emotes on 7TV`
    : "Channel emotes unavailable from 7TV.";
}

function sendChat(text) {
  try {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(text);
  } catch {}
}

function handleLine(raw, ws) {
  if (!raw || socket !== ws) return;
  const event = IRC.parseChatLine(raw);

  if (event.type === "ping") {
    sendChat("PONG :tmi.twitch.tv");
    return;
  }
  if (event.type === "ready") {
    sendChat("JOIN #" + channel);
    return;
  }
  if (event.type === "joined" || event.type === "join") {
    if (!event.channel || event.channel === channel) {
      clearTimeout(joinTimeout);
      joined = true;
      updateHealth();
      activity.textContent = "Connected to #" + channel;
    }
    return;
  }

  const id = IRC.roomId(event.tags);
  if (id && id !== roomId) {
    loadEmotes(id).catch(() => {
      emotesStatus.textContent = "7TV emotes unavailable.";
    });
  }

  if (event.type === "chat" && event.channel === channel) {
    joined = true;
    clearTimeout(joinTimeout);
    viewers.add(event.nick);
    messageCount += 1;
    if (REACT.isReaction(event.text, emotes)) reactors.add(event.nick);
    REACT.collectEmotes(event.text, emotes, emoteCounts);
    showMessage(event.nick, event.text);
    if (settings.clipOnCommand && IRC.isClipCommand(event.text) && IRC.isPrivileged(event.tags, event.nick, channel)) {
      requestClip({
        trigger: "command",
        reason: `Chat command by @${event.nick}`,
        meta: {
          participants: viewers.size,
          reactions: reactors.size,
          messages: messageCount,
          topEmotes: REACT.topEmotes(emoteCounts)
        }
      });
    }
  } else if (event.type === "usernotice" && event.channel === channel && event.raid && settings.clipOnRaid) {
    requestClip({
      trigger: "raid",
      reason: `Raid · ${event.raid.viewers} viewers`,
      meta: {
        participants: viewers.size,
        reactions: reactors.size,
        messages: messageCount,
        topEmotes: REACT.topEmotes(emoteCounts)
      }
    });
  }
}

function connect() {
  if (!channel) return;
  joined = false;
  updateHealth();
  activity.textContent = "Contacting Twitch chat…";
  let ws;
  try {
    ws = socket = new WebSocket("wss://irc-ws.chat.twitch.tv");
  } catch {
    activity.textContent = "Twitch chat is unavailable in this browser.";
    return;
  }
  clearTimeout(joinTimeout);
  joinTimeout = setTimeout(() => {
    if (socket === ws && !joined) ws.close();
  }, 12000);

  ws.onopen = () => {
    ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
    ws.send("PASS SCHMOOPIIE");
    ws.send("NICK justinfan" + Math.floor(100000 + Math.random() * 900000));
  };
  ws.onmessage = ({ data }) => {
    for (const line of String(data).split("\r\n")) handleLine(line, ws);
  };
  ws.onerror = () => {};
  ws.onclose = () => {
    clearTimeout(joinTimeout);
    if (socket !== ws) return;
    socket = null;
    joined = false;
    paceHistory = [];
    viewers.clear();
    reactors.clear();
    emoteCounts.clear();
    messageCount = 0;
    updateHealth();
    activity.textContent = "Twitch chat unavailable. Retrying in 8 seconds…";
    retry = setTimeout(connect, 8000);
  };
}

function stopCapture({ silent = false } = {}) {
  clearInterval(ticker);
  ticker = null;
  finishMoment();
  for (const recorder of recorders.splice(0)) {
    try { recorder.stop(); } catch {}
  }
  if (stream) {
    for (const track of stream.getTracks()) {
      try { track.stop(); } catch {}
    }
  }
  stream = null;
  stats = { audio: false, crop: false };
  manualButton.disabled = true;
  captureButton.textContent = "Start capture";
  updateHealth();
  if (!silent) setStatus("Capture stopped.", "");
}

function pickMime() {
  if (!window.MediaRecorder) return "";
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4"
  ];
  for (const candidate of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch {}
  }
  return "";
}

function rotate() {
  if (!stream) return;
  const track = stream.getVideoTracks()[0];
  if (!track || track.readyState === "ended") {
    stopCapture();
    return;
  }
  let recorder;
  try {
    recorder = mimeType
      ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4500000 })
      : new MediaRecorder(stream);
  } catch (error) {
    setStatus(`Recorder unavailable: ${error.message}`, "bad");
    stopCapture({ silent: true });
    return;
  }
  const chunks = [];
  recorder.chunks = chunks;
  recorder.channel = channel;
  recorder.started = Date.now();
  recorder.startedIso = new Date().toISOString();
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size) chunks.push(event.data);
  };
  recorder.onerror = (event) => {
    setStatus(`Recorder error: ${event.error && event.error.message ? event.error.message : "unknown"}`, "bad");
  };
  recorder.onstop = () => {
    finishRecording(recorder).catch((error) => {
      setStatus(`Could not save clip: ${error.message}`, "bad");
    });
  };
  try {
    recorder.start(1000);
  } catch (error) {
    setStatus(`Could not start recording: ${error.message}`, "bad");
    stopCapture({ silent: true });
    return;
  }
  recorders.push(recorder);
  while (recorders.length > settings.bufferSlots) {
    const old = recorders.shift();
    if (old && !old.reason) {
      try { old.stop(); } catch {}
    }
  }
  updateBufferHealth();
}

function finishMoment() {
  clearTimeout(tailTimer);
  const recorder = pending;
  pending = null;
  if (recorder && recorder.state !== "inactive") {
    try { recorder.stop(); } catch {}
  }
  updateBufferHealth();
}

function requestClip({ trigger = "manual", reason = "Highlight", bypassCooldown = false, meta = {} } = {}) {
  if (!stream) {
    if (trigger !== "auto") toast("Start capture first.", "warn");
    return false;
  }
  if (pending) {
    if (trigger !== "auto") toast("A clip is already saving.", "warn");
    return false;
  }
  if (!recorders.length) {
    if (trigger !== "auto") toast("The capture buffer is not ready yet.", "warn");
    return false;
  }
  const slot = recorders[0];
  if (!slot || Date.now() - slot.started < settings.minBufferMs) {
    if (trigger !== "auto") toast("The capture buffer is still warming up.", "warn");
    return false;
  }

  const now = Date.now();
  if (trigger === "auto" || trigger === "raid") {
    if (!bypassCooldown && now - lastAuto < settings.autoCooldownMs) return false;
    lastAuto = now;
  }
  if (trigger === "command") {
    if (!bypassCooldown && now - lastCommand < settings.commandCooldownMs) return false;
    lastCommand = now;
  }

  const recorder = recorders.shift();
  recorder.reason = reason;
  recorder.trigger = trigger;
  recorder.activatedAt = now;
  recorder.meta = { ...meta };
  pending = recorder;
  clearTimeout(tailTimer);
  rotate();
  if (!stream || !pending) return false;
  tailTimer = setTimeout(finishMoment, settings.postRollSec * 1000);
  setStatus(`Saving ${reason}…`, "warn");
  if (trigger !== "auto") toast(`Saving ${reason}`, "info");
  return true;
}

async function finishRecording(recorder) {
  if (!recorder.reason || !recorder.chunks || !recorder.chunks.length) return;
  const stoppedAt = Date.now();
  const blob = new Blob(recorder.chunks, { type: recorder.mimeType || "video/webm" });
  if (!blob.size) return;
  const meta = recorder.meta || {};
  const activatedAt = recorder.activatedAt || stoppedAt;
  const record = {
    id: newId(),
    channel: recorder.channel || channel,
    createdAt: recorder.startedIso || new Date(recorder.started).toISOString(),
    source: "browser-tab",
    trigger: recorder.trigger || "manual",
    reason: recorder.reason,
    durationSec: Math.max(0.1, (stoppedAt - recorder.started) / 1000),
    preRollSec: Math.max(0, (activatedAt - recorder.started) / 1000),
    postRollSec: Math.max(0, (stoppedAt - activatedAt) / 1000),
    score: Number(meta.score) || 0,
    participants: Number(meta.participants) || 0,
    reactions: Number(meta.reactions) || 0,
    messages: Number(meta.messages) || 0,
    topEmotes: Array.isArray(meta.topEmotes) ? meta.topEmotes.slice(0, 3) : [],
    mime: blob.type,
    blob
  };
  await addClip(record);
  setStatus(`Saved ${record.trigger} clip · ${fmtDuration(record.durationSec)}`, "good");
  toast(`Highlight saved: ${record.reason}`, "good");
}

function statsLine(record) {
  const parts = [];
  if (record.participants) parts.push(`${record.participants} chatters`);
  if (record.reactions) parts.push(`${record.reactions} reactions`);
  if (Array.isArray(record.topEmotes) && record.topEmotes.length) {
    parts.push(record.topEmotes.map((emote) => `${emote.name} ×${emote.count}`).join(" · "));
  }
  return parts.join(" · ") || "Saved highlight";
}

function cloudBadge() {
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.dataset.tone = "";
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "1.5");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M4 14a4 4 0 0 1 1.2-7.8A5 5 0 0 1 15 6a4 4 0 0 1 5 3.8A3.5 3.5 0 0 1 19.5 17H6.5A3.5 3.5 0 0 1 4 14Z");
  icon.append(path);
  badge.append(icon, document.createTextNode("Local"));
  return badge;
}

function renderClip(record, prepend = false) {
  if (!record || !record.blob) return;
  for (const child of libraryGrid.children) {
    if (child.dataset && child.dataset.clipId === record.id) return;
  }
  const url = URL.createObjectURL(record.blob);
  clipUrls.set(record.id, url);

  const row = document.createElement("tr");
  row.className = "clip";
  row.dataset.clipId = record.id;

  const preview = document.createElement("td");
  const video = document.createElement("video");
  video.className = "thumb";
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.src = url;
  video.setAttribute("aria-label", record.reason || "Highlight preview");
  preview.append(video);

  const when = document.createElement("td");
  const title = document.createElement("div");
  title.className = "clip-title";
  title.textContent = record.reason || "Highlight";
  const stampLine = document.createElement("div");
  stampLine.className = "meta mono num";
  stampLine.textContent = `#${record.channel || channel || "channel"} · ${fmtWhen(record.createdAt)} · ${fmtDuration(record.durationSec)}`;
  when.append(title, stampLine);

  const peak = document.createElement("td");
  peak.className = "mono num";
  const peakValue = Number(record.participants) || Number(record.score) || 0;
  peak.textContent = peakValue ? String(peakValue) : "—";
  peak.title = statsLine(record);

  const size = document.createElement("td");
  size.className = "mono num";
  size.textContent = fmtBytes(record.blob.size);

  const cloud = document.createElement("td");
  cloud.append(cloudBadge());

  const local = document.createElement("td");
  local.className = "meta";
  local.textContent = "Kept";

  const actions = document.createElement("td");
  const actionRow = document.createElement("div");
  actionRow.className = "clip-actions";
  const download = document.createElement("a");
  download.href = url;
  download.download = filenameFor(record);
  download.textContent = "Download";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "ghost";
  remove.textContent = "Delete";
  remove.addEventListener("click", () => removeClip(record.id));
  actionRow.append(download, remove);
  actions.append(actionRow);

  row.append(preview, when, peak, size, cloud, local, actions);
  if (prepend) libraryGrid.prepend(row);
  else libraryGrid.append(row);
}

function updateLibraryStats() {
  const count = clips.length;
  const bytes = clips.reduce((total, record) => total + (record.blob ? record.blob.size : 0), 0);
  $("library-count").textContent = `${count} clip${count === 1 ? "" : "s"}`;
  $("library-size").textContent = fmtBytes(bytes);
  $("download-all").disabled = count === 0;
  $("clear-library").disabled = count === 0;
  empty.hidden = count > 0;
}

async function updateStorageNote() {
  if (!storeReady) return;
  const estimate = await STORE.estimate();
  if (estimate && estimate.quota) {
    setStorageNote(`Stored locally · ${fmtBytes(estimate.usage || 0)} of ${fmtBytes(estimate.quota)} used.`);
  } else {
    setStorageNote("Clips are stored locally in this browser.");
  }
}

async function addClip(record) {
  clips.unshift(record);
  renderClip(record, true);
  updateLibraryStats();
  if (!storeReady) {
    setStorageNote("Clip is available for this session only because browser storage is unavailable.", "warn");
    return;
  }
  try {
    await STORE.putClip(record);
    if (!persistRequested) {
      persistRequested = true;
      STORE.persist().catch(() => {});
    }
    updateStorageNote();
  } catch (error) {
    storeReady = false;
    setStorageNote(`Clip is available for this session only: ${error.message}`, "warn");
  }
}

async function removeClip(id) {
  const index = clips.findIndex((record) => record.id === id);
  if (index < 0) return;
  clips.splice(index, 1);
  const url = clipUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    clipUrls.delete(id);
  }
  for (const child of [...libraryGrid.children]) {
    if (child.dataset && child.dataset.clipId === id) child.remove();
  }
  updateLibraryStats();
  if (storeReady) {
    try {
      await STORE.deleteClip(id);
    } catch (error) {
      toast(`Could not delete the stored copy: ${error.message}`, "warn");
    }
  }
}

async function downloadAll() {
  if (!clips.length) return;
  for (const record of clips) {
    const url = clipUrls.get(record.id);
    if (!url) continue;
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filenameFor(record);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  toast(`Requested ${clips.length} download${clips.length === 1 ? "" : "s"}. Allow multiple downloads if the browser asks.`, "warn");
}

async function clearLibrary() {
  if (!clips.length) return;
  if (!window.confirm("Delete every clip from this browser? Downloads already saved to disk are not affected.")) return;
  for (const url of clipUrls.values()) URL.revokeObjectURL(url);
  clipUrls.clear();
  clips = [];
  for (const child of [...libraryGrid.children]) {
    if (child.classList && child.classList.contains("clip")) child.remove();
  }
  updateLibraryStats();
  if (storeReady) {
    try {
      await STORE.clearClips();
    } catch (error) {
      toast(`Could not clear the stored library: ${error.message}`, "warn");
    }
  }
  setStorageNote("Library cleared.");
}

async function restoreLibrary() {
  if (!STORE) {
    storeReady = false;
    setStorageNote("Clip storage is unavailable in this browser.", "warn");
    updateLibraryStats();
    return;
  }
  try {
    const records = await STORE.listClips();
    const existing = new Set(clips.map((record) => record.id));
    for (const record of records) {
      if (!record || !(record.blob instanceof Blob) || existing.has(record.id)) continue;
      clips.push(record);
      renderClip(record, false);
    }
    clips.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    updateLibraryStats();
    updateStorageNote();
  } catch (error) {
    storeReady = false;
    setStorageNote(`Clips will not persist in this browser: ${error.message}`, "warn");
    updateLibraryStats();
  }
}

async function startCapture() {
  captureButton.disabled = true;
  field.disabled = true;
  try {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== "function") {
      throw new Error("Tab capture is not supported in this browser.");
    }
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "browser" },
      audio: true,
      preferCurrentTab: true,
      selfBrowserSurface: "include"
    });
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error("No video track was shared.");
    track.onended = () => stopCapture();

    let cropped = false;
    if (window.CropTarget && typeof track.cropTo === "function") {
      try {
        await track.cropTo(await window.CropTarget.fromElement($("player")));
        cropped = true;
      } catch {
        cropped = false;
      }
    }
    if (!stream || track.readyState === "ended") {
      stopCapture({ silent: true });
      return;
    }

    lastAuto = 0;
    lastCommand = 0;
    mimeType = pickMime();
    rotate();
    if (!stream) return;
    ticker = setInterval(rotate, settings.bufferSlotMs);
    stats = { audio: stream.getAudioTracks().length > 0, crop: cropped };
    captureButton.textContent = "Stop capture";
    manualButton.disabled = false;
    setStatus(
      stats.audio
        ? "Recording the player with audio. Highlights save automatically or with H."
        : "Recording video only. Re-capture and enable tab audio to include sound.",
      stats.audio ? "good" : "warn"
    );
    updateHealth();
  } catch (error) {
    stopCapture({ silent: true });
    setStatus(`Capture unavailable: ${error.message || "allow tab sharing in a desktop browser."}`, "bad");
  } finally {
    captureButton.disabled = false;
    field.disabled = false;
  }
}

function load(name) {
  clearTimeout(retry);
  clearTimeout(joinTimeout);
  clearInterval(emoteTimer);
  if (socket) {
    socket.onclose = null;
    try { socket.close(); } catch {}
    socket = null;
  }
  if (stream) stopCapture({ silent: true });
  generation += 1;
  roomId = null;
  emotes.clear();
  channel = name;
  field.value = name;
  paceHistory = [];
  viewers.clear();
  reactors.clear();
  emoteCounts.clear();
  messageCount = 0;
  lastAuto = 0;
  lastCommand = 0;
  pending = null;
  clearTimeout(tailTimer);
  feed.replaceChildren();
  emotesStatus.textContent = "Waiting for channel emotes…";
  $("monitor").hidden = false;
  $("chat").hidden = false;
  $("title").textContent = "#" + name;
  document.title = `#${name} · ClipSpike`;
  $("player").src = `https://player.twitch.tv/?channel=${encodeURIComponent(name)}&parent=${encodeURIComponent(location.hostname)}&autoplay=false`;
  try { history.replaceState(null, "", "?c=" + name); } catch {}
  setStatus("Ready. Play the stream, then start capture.", "");
  activity.textContent = "Connecting to Twitch chat…";
  captureButton.textContent = "Start capture";
  captureButton.disabled = false;
  manualButton.disabled = true;
  updateHealth();
  updateSparkline(null, 0);
  connect();
  emoteTimer = setInterval(() => {
    if (roomId) {
      loadEmotes(roomId).catch(() => {
        emotesStatus.textContent = "7TV emotes unavailable.";
      });
    }
  }, 900000);
  requestAnimationFrame(() => {
    try { $("monitor").scrollIntoView({ behavior: "smooth", block: "start" }); } catch {}
  });
}

function tick() {
  if (!channel) return;
  updateHealth();
  if (!joined) {
    viewers.clear();
    reactors.clear();
    emoteCounts.clear();
    messageCount = 0;
    updateSparkline(null, 0);
    return;
  }
  const participants = viewers.size;
  const reactions = reactors.size;
  const evaluation = REACT.evaluateReaction({
    history: paceHistory,
    participants,
    reactions,
    settings
  });
  updateSparkline(evaluation, participants);

  if (stream && !pending && Date.now() - lastAuto >= settings.autoCooldownMs && evaluation.trigger) {
    const top = REACT.topEmotes(emoteCounts);
    const reason = `Chat spike · ${participants} viewers${top.length ? ` · ${top[0].name} ×${top[0].count}` : ""}`;
    requestClip({
      trigger: "auto",
      reason,
      meta: {
        score: evaluation.score,
        participants,
        reactions,
        messages: messageCount,
        topEmotes: top
      }
    });
  }

  paceHistory.push(participants);
  if (paceHistory.length > settings.historyLimit) paceHistory.shift();
  const windowSec = Math.max(1, settings.sampleMs / 1000);
  const rate = messageCount / windowSec;
  activity.textContent = `#${channel}  ${rate.toFixed(1)} msg/s  ${participants} chatters`;
  viewers.clear();
  reactors.clear();
  emoteCounts.clear();
  messageCount = 0;
}

function bindEvents() {
  $("channel-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = field.value.trim().toLowerCase();
    if (!/^[a-z0-9_]{1,25}$/.test(name)) {
      setStatus("Enter a Twitch username using letters, numbers, or underscores.", "bad");
      field.focus();
      return;
    }
    load(name);
  });

  captureButton.addEventListener("click", () => {
    if (stream) stopCapture();
    else startCapture();
  });

  manualButton.addEventListener("click", () => {
    requestClip({ trigger: "manual", reason: "Manual highlight", bypassCooldown: true });
  });

  for (const id of ["sensitivity", "cooldown", "postroll", "minparticipants"]) {
    $(id).addEventListener("input", saveSettingsFromForm);
  }
  $("reset-settings").addEventListener("click", () => {
    settings = CONFIG.settingsFor("web");
    CONFIG.saveSettings(settings, storage());
    applySettingsToForm();
    toast("Detection settings reset.", "info");
  });

  $("download-all").addEventListener("click", downloadAll);
  $("clear-library").addEventListener("click", clearLibrary);

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    const tag = target && target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (target && target.isContentEditable)) return;
    if ((event.key === "h" || event.key === "H") && !manualButton.disabled) {
      event.preventDefault();
      manualButton.click();
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (!pending) return;
    event.preventDefault();
    event.returnValue = "";
  });

  window.addEventListener("resize", () => drawSparkline(lastSparkValues, lastSparkThreshold));
}

function init() {
  applySettingsToForm();
  bindEvents();
  restoreLibrary();
  setInterval(tick, settings.sampleMs);
  const requested = new URLSearchParams(location.search).get("c");
  if (/^[a-z0-9_]{1,25}$/i.test(requested || "")) load(requested.toLowerCase());
  document.documentElement.dataset.ready = "true";
}

init();
