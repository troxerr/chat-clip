const test = require("node:test");
const assert = require("node:assert/strict");
const p = require("../lib/platform.js");

test("state and output paths per platform", () => {
  assert.equal(p.stateDir({ APPDATA: "C:\\Users\\a\\AppData\\Roaming" }, "win32", "C:\\Users\\a"), "C:\\Users\\a\\AppData\\Roaming\\ClipSpike");
  assert.equal(p.stateDir({}, "darwin", "/Users/a"), "/Users/a/Library/Application Support/ClipSpike");
  assert.equal(p.outputRoot({ USERPROFILE: "C:\\Users\\a" }, "win32", "C:\\Users\\a"), "C:\\Users\\a\\Videos\\ClipSpike");
  assert.equal(p.outputRoot({}, "darwin", "/Users/a"), "/Users/a/Movies/ClipSpike");
});

test("env overrides win on every platform", () => {
  assert.equal(p.stateDir({ CLIPSPIKE_STATE: "/tmp/x" }, "win32"), require("node:path").resolve("/tmp/x"));
  assert.equal(p.outputRoot({ CLIPSPIKE_OUTPUT: "/tmp/o" }, "win32"), require("node:path").resolve("/tmp/o"));
});

test("fonts, ffmpeg candidates and default encoder", () => {
  assert.ok(p.fontCandidates("win32", { SystemRoot: "C:\\Windows" })[0].endsWith("arialbd.ttf"));
  assert.ok(p.fontCandidates("darwin")[0].startsWith("/System/Library"));
  assert.deepEqual(p.ffmpegCandidates("win32"), ["ffmpeg"]);
  assert.equal(p.defaultEncoder("darwin"), "h264_videotoolbox");
  assert.equal(p.defaultEncoder("win32"), "auto");
});

test("filter paths accept Windows drive paths and escape the colon", () => {
  const { filterPath } = require("../lib/overlays.js");
  assert.equal(filterPath("C:\\Windows\\Fonts\\arialbd.ttf"), "C\\:/Windows/Fonts/arialbd.ttf");
  assert.equal(filterPath("/tmp/a_b-1.txt"), "/tmp/a_b-1.txt");
  assert.throws(() => filterPath("/tmp/a'b;c"));
});
