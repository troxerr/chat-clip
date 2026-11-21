"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const freeTier = require("../lib/freetier.js");
const { buildReframeFilter, reframeClip } = require("../lib/reframe.js");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "hd-free-"));
// The shipped app uses its bundled ffmpeg, which is missing drawtext and PNG decoding: test against it when present.
const bundled = path.join(__dirname, "..", "mac", "runtime", process.arch === "arm64" ? "arm64" : "x86_64", "bin", "ffmpeg");
const have = (cmd) => !spawnSync(cmd, ["-version"], { stdio: "ignore" }).error;

test("plan defaults to pro unless the app marks it free", () => {
  assert.equal(freeTier.currentPlan({}), "pro");
  assert.equal(freeTier.currentPlan({ CLIPSPIKE_PLAN: "free" }), "free");
  const status = freeTier.status({ dir: tmp(), plan: "pro" });
  assert.equal(status.watermark, false);
  assert.equal(status.remaining, null);
});

test("weeks start on Monday at local midnight", () => {
  const wednesday = new Date(2026, 10, 18, 15, 30); // Wed Nov 18 2026
  const start = freeTier.weekStart(wednesday);
  assert.equal(start.getDay(), 1);
  assert.equal(start.getDate(), 16);
  assert.equal(start.getHours(), 0);
  assert.equal(freeTier.weekStart(new Date(2026, 10, 22, 23, 59)).getDate(), 16); // Sunday still the same week
  assert.equal(freeTier.nextWeekStart(wednesday).getDate(), 23);
});

test("three clean clips per week, then watermark, then reset on Monday", () => {
  const dir = tmp();
  const now = new Date(2026, 10, 18, 12);
  for (let used = 0; used < 3; used++) {
    const status = freeTier.status({ dir, plan: "free", now });
    assert.equal(status.watermark, false);
    assert.equal(status.remaining, 3 - used);
    assert.equal(freeTier.recordClip({ dir, now }), true);
  }
  const over = freeTier.status({ dir, plan: "free", now });
  assert.equal(over.watermark, true);
  assert.equal(over.remaining, 0);
  const nextWeek = freeTier.status({ dir, plan: "free", now: new Date(2026, 10, 23, 9) });
  assert.equal(nextWeek.watermark, false);
  assert.equal(nextWeek.used, 0);
});

test("a corrupt usage file counts as a fresh week and never throws", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "free-tier.json"), "{nope");
  assert.equal(freeTier.status({ dir, plan: "free" }).used, 0);
  assert.equal(freeTier.recordClip({ dir: path.join(dir, "free-tier.json", "x") }), false);
});

test("reframe filter is unchanged without a watermark and branches with one", () => {
  const base = { width: 1080, height: 1920, blur: 20, layout: "blur" };
  assert.match(buildReframeFilter(base), /overlay=\(W-w\)\/2:\(H-h\)\/2:format=auto,format=yuv420p\[v\]$/);
  const marked = buildReframeFilter({ ...base, watermark: { file: "/tmp/hd/watermark.png" } });
  assert.match(marked, /null\[vm\];movie=\/tmp\/hd\/watermark\.png/);
  assert.match(marked, /\[vm\]\[wm\]overlay=.*format=yuv420p\[v\]$/);
  assert.match(buildReframeFilter({ ...base, layout: "split", watermark: { file: "/tmp/hd/w.png" } }), /vstack=inputs=2,null\[vm\]/);
  assert.throws(() => buildReframeFilter({ ...base, watermark: { file: "/tmp/has space/w.png" } }), /Unsafe watermark/);
});

test("renders a watermarked clip with the bundled filters", { skip: !have("ffmpeg") }, async () => {
  const dir = tmp();
  const input = path.join(dir, "in.mp4");
  const generated = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30", "-t", "2", "-pix_fmt", "yuv420p", input], { stdio: "ignore", timeout: 60000 });
  assert.equal(generated.status, 0);
  const watermark = freeTier.prepareWatermark();
  assert.ok(watermark && fs.existsSync(watermark.file));
  for (const layout of ["blur", "split"]) {
    const output = path.join(dir, `${layout}.mp4`);
    const result = await reframeClip({ input, output, width: 1080, height: 1920, crf: 24, preset: "ultrafast", layout, watermark, ffmpegPath: fs.existsSync(bundled) ? bundled : "ffmpeg" });
    assert.equal(result.ok, true, result.error);
    assert.ok(fs.statSync(output).size > 1000);
  }
});
