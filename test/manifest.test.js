const test = require("node:test");
const assert = require("node:assert/strict");
const { parseManifest, contiguousRun, medianSegmentDuration, planClip } = require("../lib/manifest.js");

const CSV = [
  "00000001.ts,0.000000,3.000000",
  "00000002.ts,3.000000,6.000000",
  "00000003.ts,6.000000,9.000000",
  "00000004.ts,9.000000,12.000000",
  "00000005.ts,12.000000,15.000000"
].join("\n");

test("parses and sorts segment rows", () => {
  const rows = parseManifest(CSV);
  assert.equal(rows.length, 5);
  assert.equal(rows[0].file, "00000001.ts");
  assert.equal(rows.at(-1).end, 15);
});

test("ignores malformed and incomplete lines", () => {
  const rows = parseManifest([
    "",
    "not a segment",
    "00000002.ts,3.000000",
    "00000003.ts,6,5",
    "00000004.ts,x,9",
    "00000005.ts,9.000000,12.000000",
    "00000005.ts,9.000000,12.000000"
  ].join("\n"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].file, "00000005.ts");
});

test("detects a complete window and its offset", () => {
  const rows = parseManifest(CSV);
  const plan = planClip(rows, 3, 12);
  assert.equal(plan.ready, true);
  assert.equal(plan.truncated, false);
  assert.equal(plan.usable, true);
  assert.equal(plan.offset, 0);
  assert.equal(plan.duration, 9);
  assert.deepEqual(plan.rows.map((row) => row.file), ["00000002.ts", "00000003.ts", "00000004.ts"]);
});

test("computes a non-zero offset into the first segment", () => {
  const rows = parseManifest(CSV);
  const plan = planClip(rows, 4, 10);
  assert.equal(plan.ready, true);
  assert.equal(plan.offset, 1);
  assert.equal(plan.duration, 6);
});

test("marks a window truncated at the live edge", () => {
  const rows = parseManifest(CSV);
  const plan = planClip(rows, 3, 20);
  assert.equal(plan.truncated, true);
  assert.equal(plan.ready, false);
  assert.equal(plan.usable, true);
  assert.equal(plan.end, 15);
});

test("does not concatenate across a stream gap", () => {
  const rows = parseManifest([
    "00000001.ts,0,3",
    "00000002.ts,3,6",
    "00000003.ts,6,9",
    "00000004.ts,20,23",
    "00000005.ts,23,26"
  ].join("\n"));
  const plan = planClip(rows, 0, 24, { gapTolerance: 6 });
  assert.equal(plan.ready, false);
  assert.equal(plan.truncated, true);
  assert.equal(plan.end, 9);
  assert.equal(plan.rows.length, 3);
});

test("contiguousRun stops at a gap", () => {
  const rows = parseManifest([
    "00000001.ts,0,3",
    "00000002.ts,3,6",
    "00000003.ts,20,23"
  ].join("\n"));
  assert.equal(contiguousRun(rows, 4, 6).length, 2);
});

test("contiguousRun handles a center before the first segment", () => {
  const rows = parseManifest(CSV);
  assert.equal(contiguousRun(rows, -5, 6).length, 5);
});

test("handles empty and invalid input", () => {
  assert.deepEqual(parseManifest(""), []);
  const empty = planClip([], 0, 10);
  assert.equal(empty.usable, false);
  assert.equal(planClip(parseManifest(CSV), 10, 10).usable, false);
});

test("reports the median segment duration", () => {
  const rows = parseManifest(CSV);
  assert.equal(medianSegmentDuration(rows), 3);
  assert.equal(medianSegmentDuration([]), 3);
});
