"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const overlays = require("../lib/overlays.js");
const { buildReframeFilter, buildArgs } = require("../lib/reframe.js");
const captions = require("../lib/captions.js");

const chat = (offset, user, text, emotes = []) => ({ id: `${user}-${offset}`, offset, user, text, emotes });

test("pickHookText takes the most repeated message near the moment, uppercased", () => {
  const comments = [
    chat(98, "a", "no way he hit that"),
    chat(99, "b", "No  way he hit THAT"),
    chat(100, "c", "no way he hit that"),
    chat(101, "d", "lol"),
    chat(101, "e", "lol"),
    chat(130, "f", "no way he hit that") // outside the window
  ];
  assert.equal(overlays.pickHookText(comments, 100), "NO WAY HE HIT THAT");
});

test("pickHookText counts each chatter once", () => {
  const comments = [
    chat(100, "spammer", "W stream"), chat(100.5, "spammer", "W stream"), chat(101, "spammer", "W stream"),
    chat(100, "x", "insane play"), chat(101, "y", "insane play")
  ];
  assert.equal(overlays.pickHookText(comments, 100), "INSANE PLAY");
});

test("pickHookText ignores emote spam when a text message exists, but falls back to it", () => {
  const spam = ["a", "b", "c", "d"].map((u) => chat(100, u, "KEKW KEKW", ["KEKW"]));
  assert.equal(overlays.pickHookText([...spam, chat(101, "e", "he is so bad")], 100), "HE IS SO BAD");
  assert.equal(overlays.pickHookText(spam, 100), "KEKW KEKW");
  assert.equal(overlays.pickHookText([chat(100, "a", "OMEGALUL"), chat(100, "b", "OMEGALUL"), chat(100, "c", "wow nice")], 100, { emotes: ["OMEGALUL"] }), "WOW NICE");
});

test("pickHookText enforces the 3 to 40 character range", () => {
  const comments = [chat(100, "a", "gg"), chat(100, "b", "gg"), chat(100, "c", "x".repeat(41)), chat(100, "d", "x".repeat(41))];
  assert.equal(overlays.pickHookText(comments, 100), "");
});

test("wrapText keeps at most two lines of about 32 characters", () => {
  assert.deepEqual(overlays.wrapText("SHORT ONE"), ["SHORT ONE"]);
  const lines = overlays.wrapText("THIS IS A MUCH LONGER HOOK LINE THAT WILL NEED TO WRAP ONTO A SECOND LINE AND THEN SOME");
  assert.equal(lines.length, 2);
  for (const line of lines) assert.ok(line.length <= 32, line);
  assert.ok(lines[1].endsWith("…"));
});

test("buildHookFilters draws each line from a text file, centered above the video", () => {
  const filters = overlays.buildHookFilters({ lineFiles: ["/tmp/hd/hook-1.txt", "/tmp/hd/hook-2.txt"], fontFile: "/tmp/hd/font.ttf", lineLengths: [20, 12] });
  assert.equal(filters.length, 2);
  for (const filter of filters) {
    assert.match(filter, /^drawtext=fontfile=\/tmp\/hd\/font\.ttf:textfile=\/tmp\/hd\/hook-\d\.txt:/);
    assert.match(filter, /expansion=none/);
    assert.match(filter, /fontcolor=white/);
    assert.match(filter, /bordercolor=black/);
    assert.match(filter, /x=\(w-text_w\)\/2/);
  }
  const band = overlays.videoBand({ width: 1080, height: 1920 });
  const ys = filters.map((f) => Number(f.match(/:y=(\d+)/)[1]));
  assert.ok(ys[0] < ys[1]);
  assert.ok(ys[1] < band.top, "hook must sit above the video");
});

test("filter paths with spaces or quotes are refused", () => {
  assert.throws(() => overlays.filterPath("/tmp/my folder/x.txt"));
  assert.throws(() => overlays.filterPath("/tmp/a'b:c.txt"));
  assert.equal(overlays.filterPath("/var/folders/ab/T/hd-overlay-x1/hook-1.txt"), "/var/folders/ab/T/hd-overlay-x1/hook-1.txt");
});

test("prepareHook writes the text to files, so no text reaches the filter graph", () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "hd-test-"));
  const font = path.join(dir, "Some Font.ttf");
  fs.writeFileSync(font, "");
  try {
    const prepared = overlays.prepareHook(dir, "IT'S 100% \"OVER\": GG; [LOL]", { fontFile: font });
    assert.deepEqual(prepared.lines, ["IT'S 100% \"OVER\": GG; [LOL]"]);
    assert.equal(fs.readFileSync(path.join(dir, "hook-1.txt"), "utf8"), prepared.lines[0]);
    for (const filter of prepared.filters) assert.ok(!filter.includes("OVER") && !filter.includes("Some Font"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("wordsFromWhisperJson skips blank-audio markers and speaker turns", () => {
  const json = { transcription: [
    { text: " >>", offsets: { from: 0, to: 100 } },
    { text: " Oh", offsets: { from: 100, to: 300 } },
    { text: " [BLANK_AUDIO]", offsets: { from: 300, to: 900 } },
    { text: " my", offsets: { from: 900, to: 1100 } }
  ] };
  assert.deepEqual(overlays.wordsFromWhisperJson(json).map((w) => w.text), ["Oh", "my"]);
});

test("groupWords makes short captions and breaks at pauses and sentence ends", () => {
  const w = (text, start, end) => ({ text, start, end });
  const cues = overlays.groupWords([
    w("no", 0, 0.2), w("way", 0.2, 0.4), w("he", 0.4, 0.5), w("actually", 0.5, 0.9),
    w("did", 2.0, 2.2), w("it.", 2.2, 2.4), w("Wow", 2.5, 2.7)
  ], { maxWords: 3 });
  assert.deepEqual(cues.map((c) => c.text), ["no way he", "actually", "did it.", "Wow"]);
  assert.equal(cues[0].start, 0);
  assert.equal(cues[0].end, 0.5);
});

test("buildAss styles big bold white captions over the lower part of the video", () => {
  const ass = overlays.buildAss([{ start: 1.25, end: 2.5, text: "no {way} he" }], { width: 1080, height: 1920 });
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /PlayResY: 1920/);
  const style = ass.split("\n").find((line) => line.startsWith("Style: Caption,"));
  const fields = style.slice(7).split(",");
  assert.equal(fields[2], "84"); // size
  assert.equal(fields[3], "&H00FFFFFF"); // white
  assert.equal(fields[7], "-1"); // bold
  assert.equal(fields[18], "2"); // bottom center
  const marginV = Number(fields[21]);
  const band = overlays.videoBand({ width: 1080, height: 1920 });
  assert.ok(1920 - marginV < band.bottom && 1920 - marginV > band.top + band.videoHeight * 0.66, "caption baseline in the lower third of the video");
  assert.match(ass, /Dialogue: 0,0:00:01\.25,0:00:02\.50,Caption,,0,0,0,,NO WAY HE/);
});

test("buildCaptionFilter points the subtitles filter at the ASS file", () => {
  assert.equal(overlays.buildCaptionFilter({ assFile: "/tmp/hd/captions.ass" }), "subtitles=filename=/tmp/hd/captions.ass");
});

test("reframe filter is unchanged without extras and appends extras before the pixel format", () => {
  const base = buildReframeFilter({ width: 1080, height: 1920, blur: 20 });
  assert.ok(base.endsWith("[bgout][fgout]overlay=(W-w)/2:(H-h)/2:format=auto,format=yuv420p[v]"));
  const extended = buildReframeFilter({ width: 1080, height: 1920, blur: 20, extraFilters: ["drawtext=textfile=/tmp/a.txt", "subtitles=filename=/tmp/b.ass"] });
  assert.ok(extended.endsWith("overlay=(W-w)/2:(H-h)/2:format=auto,drawtext=textfile=/tmp/a.txt,subtitles=filename=/tmp/b.ass,format=yuv420p[v]"));
  const args = buildArgs({ input: "in.mp4", output: "out.mp4", width: 1080, height: 1920, blur: 20, extraFilters: ["subtitles=filename=/tmp/b.ass"] });
  assert.match(args[args.indexOf("-filter_complex") + 1], /subtitles=filename=\/tmp\/b\.ass,format=yuv420p\[v\]$/);
});

test("captions finds whisper-cli on PATH or in the bundled runtime", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hd-whisper-"));
  const bin = path.join(dir, process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli");
  fs.writeFileSync(bin, "#!/bin/sh\n");
  fs.chmodSync(bin, 0o755);
  try {
    assert.equal(captions.findWhisper({ env: { PATH: dir }, extraDirs: [] }), bin);
    assert.equal(captions.findWhisper({ env: { PATH: "/nonexistent" }, extraDirs: [dir] }), bin);
    assert.equal(captions.findWhisper({ env: { PATH: "/nonexistent" }, extraDirs: [] }), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the captions model lives in Application Support/ClipSpike/models", () => {
  assert.equal(captions.modelPath({ CLIPSPIKE_STATE: "/x/state" }), path.join(path.resolve("/x/state"), "models", "ggml-base.en.bin"));
  assert.match(captions.MODEL_URL, /^https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp\/resolve\/main\/ggml-base\.en\.bin$/);
});

test("pickHookText strips the invisible characters chat clients add", () => {
  const comments = [chat(100, "a", "LOL \u034F"), chat(100, "b", "LOL"), chat(100, "c", "LOL \u{E0000}")];
  assert.equal(overlays.pickHookText(comments, 100), "LOL");
});

test("wordsFromWhisperJson drops sound tags that whisper split into words", () => {
  const seg = (text, from) => ({ text: " " + text, offsets: { from, to: from + 100 } });
  const json = { transcription: [seg("(audience", 0), seg("applauding)", 100), seg("Yes!", 200), seg("[MUSIC", 300), seg("PLAYING]", 400), seg("Fight!", 500)] };
  assert.deepEqual(overlays.wordsFromWhisperJson(json).map((w) => w.text), ["Yes!", "Fight!"]);
});

test("pickHookText prefers a multi-word message sent by at least 40% as many chatters", () => {
  const many = (text, count, offset = 100) => Array.from({ length: count }, (_, i) => chat(offset, `${text}-${i}`, text));
  // 4 of 10 is exactly 40%: the phrase wins.
  assert.equal(overlays.pickHookText([...many("LOL", 10), ...many("he actually did it", 4)], 100), "HE ACTUALLY DID IT");
  // 3 of 10 is below 40%: back to the top message.
  assert.equal(overlays.pickHookText([...many("LOL", 10), ...many("he actually did it", 3)], 100), "LOL");
  // A phrase that is already on top wins regardless.
  assert.equal(overlays.pickHookText([...many("LOL", 2), ...many("no shot", 5)], 100), "NO SHOT");
  // Only single words: the most repeated one.
  assert.equal(overlays.pickHookText([...many("LOL", 3), ...many("WOW", 2)], 100), "LOL");
});
