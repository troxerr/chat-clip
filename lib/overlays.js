"use strict";

// Optional overlays for VOD clips, burned into the same encode as the 9:16
// reframe: a hook line in the blurred area above the video, and short-form
// style captions over the lower third of the video.
//
// Everything here is pure (no ffmpeg, no network) except the small helpers at
// the bottom that probe ffmpeg and write the temp files the filters read.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const platform = require("./platform.js");

const FONT_CANDIDATES = platform.fontCandidates();

// ---------------------------------------------------------------------------
// Hook text

// Chat clients append invisible characters (U+034F, U+E0000 tags, U+2800) to
// dodge Twitch's duplicate-message filter; drop them before comparing.
function cleanChatText(text) {
  return String(text || "")
    .replace(/[\p{Cf}\u034F\u2800\u{E0000}-\u{E007F}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMessage(text) {
  return cleanChatText(text)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isEmoteOnly(text, emoteSet) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  return words.every((word) => emoteSet.has(word));
}

// The most repeated chat message in the 10 seconds around a moment. Messages
// are grouped case- and spacing-insensitively and counted once per chatter.
// Pure emote spam only wins when nobody typed real words. A message of two or
// more words is preferred when at least 40% as many chatters sent it as the
// top single-word one ("NO WAY HE HIT THAT" beats a slightly louder "LOL").
function pickHookText(comments, at, { emotes = [], windowSec = 10, minLength = 3, maxLength = 40 } = {}) {
  const emoteSet = emotes instanceof Set ? emotes : new Set(emotes);
  const from = at - windowSec / 2;
  const to = at + windowSec / 2;
  const groups = new Map();
  for (const comment of comments || []) {
    if (!(comment.offset >= from && comment.offset <= to)) continue;
    const original = cleanChatText(comment.text);
    const key = normalizeMessage(original);
    if (key.length < minLength || key.length > maxLength) continue;
    const ownEmotes = new Set([...emoteSet, ...(comment.emotes || [])]);
    let group = groups.get(key);
    if (!group) {
      group = { key, users: new Set(), first: comment.offset, emoteOnly: isEmoteOnly(original, ownEmotes), sample: original };
      groups.set(key, group);
    }
    group.users.add(comment.user || comment.id || `${comment.offset}`);
    if (!isEmoteOnly(original, ownEmotes)) group.emoteOnly = false;
  }
  const ranked = [...groups.values()].sort((a, b) => b.users.size - a.users.size || a.first - b.first);
  const text = ranked.filter((group) => !group.emoteOnly);
  const pool = text.length ? text : ranked;
  if (!pool.length) return "";
  const wordCount = (group) => group.key.split(" ").length;
  const multi = pool.find((group) => wordCount(group) >= 2);
  const single = pool.find((group) => wordCount(group) === 1);
  const best = multi && (!single || multi.users.size >= 0.4 * single.users.size) ? multi : pool[0];
  return best.sample.toUpperCase();
}

// Word-wraps to at most maxLines lines of about maxChars; overflow ends in "…".
function wrapText(text, { maxChars = 32, maxLines = 2 } = {}) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let current = "";
  let truncated = false;
  for (let word of words) {
    if (word.length > maxChars) word = word.slice(0, maxChars - 1) + "…";
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) { current = next; continue; }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines) { truncated = true; current = ""; break; }
  }
  if (current && lines.length < maxLines) lines.push(current);
  else if (current) truncated = true;
  if (truncated && lines.length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = (last.length >= maxChars ? last.slice(0, maxChars - 1) : last) + "…";
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Layout of the reframed frame: the source is scaled to the full width and
// centered, so the blurred band above it is where the hook goes.

function videoBand({ width = 1080, height = 1920, sourceAspect = 16 / 9 } = {}) {
  const videoHeight = Math.min(height, Math.round(width / sourceAspect));
  const top = Math.round((height - videoHeight) / 2);
  return { top, bottom: top + videoHeight, videoHeight };
}

// Paths go into the filter graph unquoted, so only allow characters that need
// no escaping at either filter level. Temp files are always created that way.
function filterPath(file) {
  // Windows paths: use forward slashes and escape the drive-letter colon.
  const value = String(file || "").replace(/\\/g, "/");
  if (!/^(?:[A-Za-z]:)?[A-Za-z0-9_\/.~\-]+$/.test(value)) throw new Error(`Unsafe path for an ffmpeg filter: ${String(file || "")}`);
  return value.replace(/^([A-Za-z]):/, "$1\\:");
}

// One drawtext per line, so every line is centered on its own.
function buildHookFilters({ lineFiles, fontFile, width = 1080, height = 1920, sourceAspect = 16 / 9, lineLengths = [] }) {
  if (!lineFiles || !lineFiles.length) return [];
  const scale = width / 1080;
  const longest = Math.max(1, ...lineLengths);
  // Bold uppercase Arial averages about 0.7 em per character.
  const fontSize = Math.round(Math.max(40 * scale, Math.min(88 * scale, (width * 0.9) / (longest * 0.7))));
  const lineHeight = Math.round(fontSize * 1.18);
  const band = videoBand({ width, height, sourceAspect });
  const blockHeight = lineHeight * lineFiles.length;
  const blockTop = Math.max(Math.round(24 * scale), band.top - Math.round(56 * scale) - blockHeight);
  return lineFiles.map((file, index) => [
    "drawtext=fontfile=" + filterPath(fontFile),
    "textfile=" + filterPath(file),
    "reload=0",
    "expansion=none",
    "fontcolor=white",
    `fontsize=${fontSize}`,
    "bordercolor=black",
    `borderw=${Math.max(2, Math.round(fontSize / 12))}`,
    "x=(w-text_w)/2",
    `y=${blockTop + index * lineHeight}`
  ].join(":"));
}

// ---------------------------------------------------------------------------
// Captions

// whisper.cpp -ml 1 -sow -oj gives one segment per word with millisecond offsets.
function wordsFromWhisperJson(json) {
  const segments = (json && json.transcription) || [];
  const words = [];
  let depth = 0; // inside a sound tag like (upbeat music) or [BLANK_AUDIO], which -ml 1 splits into words
  for (const segment of segments) {
    const text = String(segment.text || "").trim();
    const opens = (text.match(/[([]/g) || []).length;
    const closes = (text.match(/[)\]]/g) || []).length;
    const tagged = depth > 0 || opens > 0;
    depth = Math.max(0, depth + opens - closes);
    if (!text || tagged) continue;
    if (!/[\p{L}\p{N}]/u.test(text)) continue; // ">>" speaker turns, stray punctuation
    const from = Number(segment.offsets && segment.offsets.from) / 1000;
    const to = Number(segment.offsets && segment.offsets.to) / 1000;
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    words.push({ text, start: from, end: Math.max(to, from + 0.05) });
  }
  return words;
}

// Short-form captions: up to maxWords per line, broken early at a pause or at
// the end of a sentence.
function groupWords(words, { maxWords = 3, maxGapSec = 0.6, maxDurationSec = 2.2 } = {}) {
  const cues = [];
  let current = null;
  for (const word of words) {
    const startsNew = !current
      || current.words.length >= maxWords
      || word.start - current.end > maxGapSec
      || word.end - current.start > maxDurationSec
      || /[.!?]$/.test(current.words[current.words.length - 1]);
    if (startsNew) {
      current = { start: word.start, end: word.end, words: [] };
      cues.push(current);
    }
    current.words.push(word.text);
    current.end = word.end;
  }
  return cues.map((cue) => ({ start: cue.start, end: cue.end, text: cue.words.join(" ") }));
}

function assTime(seconds) {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const cs = Math.floor((total - Math.floor(total)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function assText(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/[{}]/g, "")
    .replace(/\r?\n/g, " ")
    .toUpperCase();
}

function buildAss(cues, { width = 1080, height = 1920, sourceAspect = 16 / 9, font = "Arial" } = {}) {
  const scale = width / 1080;
  const band = videoBand({ width, height, sourceAspect });
  // Bottom of the caption sits a little above the bottom edge of the video.
  const marginV = Math.max(0, height - band.bottom + Math.round(36 * scale));
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,${font},${Math.round(84 * scale)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,${Math.round(7 * scale)},${Math.round(2 * scale)},2,${Math.round(60 * scale)},${Math.round(60 * scale)},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
  ];
  const events = cues.map((cue) => `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Caption,,0,0,0,,${assText(cue.text)}`);
  return header.concat(events).join("\n") + "\n";
}

function buildCaptionFilter({ assFile }) {
  return "subtitles=filename=" + filterPath(assFile);
}

// ---------------------------------------------------------------------------
// Environment helpers

function findFont() {
  return FONT_CANDIDATES.find((file) => {
    try { return fs.statSync(file).isFile(); } catch { return false; }
  }) || null;
}

const filterCache = new Map();
function ffmpegFilters(ffmpegPath) {
  if (filterCache.has(ffmpegPath)) return filterCache.get(ffmpegPath);
  const result = spawnSync(ffmpegPath, ["-hide_banner", "-filters"], { encoding: "utf8", timeout: 8000 });
  const names = new Set();
  if (!result.error) {
    for (const line of String(result.stdout || "").split("\n")) {
      const match = line.match(/^\s*[A-Z.]{2,3}\s+(\S+)\s+\S+->\S+/);
      if (match) names.add(match[1]);
    }
  }
  filterCache.set(ffmpegPath, names);
  return names;
}

// Picks an ffmpeg that can draw text and/or subtitles: the one on PATH first,
// then Homebrew's keg-only ffmpeg-full, which has freetype and libass.
function overlayFfmpeg({ needText = false, needSubtitles = false, candidates } = {}) {
  const list = candidates || platform.ffmpegCandidates();
  for (const candidate of list) {
    if (candidate.includes("/") && !fs.existsSync(candidate)) continue;
    const filters = ffmpegFilters(candidate);
    if ((!needText || filters.has("drawtext")) && (!needSubtitles || filters.has("subtitles"))) return candidate;
  }
  return null;
}

// A temp folder whose path is safe to put straight into a filter graph.
function makeOverlayDir() {
  const roots = [os.tmpdir(), "/tmp"];
  for (const root of roots) {
    try {
      const dir = fs.mkdtempSync(path.join(fs.realpathSync(root), "hd-overlay-"));
      filterPath(dir);
      return dir;
    } catch {}
  }
  throw new Error("Could not create a temp folder for clip overlays.");
}

// Writes the hook lines (and a font link with a safe name) for buildHookFilters.
function prepareHook(dir, text, { width = 1080, height = 1920, fontFile = findFont() } = {}) {
  const lines = wrapText(text, { maxChars: 32, maxLines: 2 });
  if (!lines.length) return null;
  if (!fontFile) throw new Error("No bold font found for the hook line.");
  const fontLink = path.join(dir, "font" + (path.extname(fontFile) || ".ttf"));
  try { fs.rmSync(fontLink, { force: true }); } catch {}
  fs.symlinkSync(fontFile, fontLink);
  const lineFiles = lines.map((line, index) => {
    const file = path.join(dir, `hook-${index + 1}.txt`);
    fs.writeFileSync(file, line);
    return file;
  });
  return {
    lines,
    filters: buildHookFilters({ lineFiles, fontFile: fontLink, width, height, lineLengths: lines.map((line) => line.length) })
  };
}

module.exports = {
  cleanChatText,
  normalizeMessage,
  isEmoteOnly,
  pickHookText,
  wrapText,
  videoBand,
  filterPath,
  buildHookFilters,
  wordsFromWhisperJson,
  groupWords,
  assTime,
  buildAss,
  buildCaptionFilter,
  findFont,
  ffmpegFilters,
  overlayFfmpeg,
  makeOverlayDir,
  prepareHook
};
