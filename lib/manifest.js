"use strict";

const SEGMENT_PATTERN = /^\d{8}\.ts$/;

function parseManifest(text) {
  const rows = [];
  const seen = new Set();
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(",");
    if (parts.length < 3) continue;
    const file = parts[0].replace(/^"|"$/g, "");
    if (!SEGMENT_PATTERN.test(file) || seen.has(file)) continue;
    const start = Number(parts[1]);
    const end = Number(parts[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    seen.add(file);
    rows.push({ file, start, end });
  }
  rows.sort((a, b) => a.start - b.start || a.file.localeCompare(b.file));
  return rows;
}

function medianSegmentDuration(rows, fallback = 3) {
  if (!rows.length) return fallback;
  const durations = rows.map((row) => row.end - row.start).filter((value) => value > 0);
  if (!durations.length) return fallback;
  durations.sort((a, b) => a - b);
  const middle = Math.floor(durations.length / 2);
  return durations.length % 2 ? durations[middle] : (durations[middle - 1] + durations[middle]) / 2;
}

function contiguousRun(rows, center, gapTolerance = 6) {
  if (!rows.length) return [];
  let index = rows.findIndex((row) => row.start <= center && row.end > center);
  if (index < 0) {
    index = 0;
    for (let i = 0; i < rows.length; i += 1) {
      if (rows[i].start <= center) index = i;
      else break;
    }
  }
  let first = index;
  let last = index;
  while (first > 0 && rows[first].start - rows[first - 1].end <= gapTolerance) first -= 1;
  while (last < rows.length - 1 && rows[last + 1].start - rows[last].end <= gapTolerance) last += 1;
  return rows.slice(first, last + 1);
}

function planClip(rows, start, end, options = {}) {
  const gapTolerance = options.gapTolerance ?? 6;
  const minDuration = options.minDuration ?? 3;
  const empty = {
    rows: [],
    run: [],
    start,
    end,
    offset: 0,
    duration: 0,
    ready: false,
    truncated: true,
    usable: false
  };
  if (!Array.isArray(rows) || !rows.length) return empty;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return empty;

  const center = start + (end - start) / 2;
  const run = contiguousRun(rows, center, gapTolerance);
  if (!run.length) return empty;

  const first = run.find((row) => row.end > start) || run[run.length - 1];
  const last = [...run].reverse().find((row) => row.start < end) || run[0];
  const clipStart = Math.max(start, first.start);
  const clipEnd = Math.min(end, last.end);
  if (clipEnd <= clipStart) return empty;

  const selected = run.filter((row) => row.end > clipStart && row.start < clipEnd);
  if (!selected.length) return empty;

  const offset = Math.max(0, clipStart - selected[0].start);
  const duration = clipEnd - clipStart;
  const startCovered = selected[0].start <= start + 0.25;
  const endCovered = selected[selected.length - 1].end >= end - 0.25;
  const ready = startCovered && endCovered;

  return {
    rows: selected,
    run,
    start: clipStart,
    end: clipEnd,
    offset,
    duration,
    ready,
    truncated: !ready,
    usable: duration >= minDuration
  };
}

module.exports = {
  parseManifest,
  medianSegmentDuration,
  contiguousRun,
  planClip
};
