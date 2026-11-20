const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeFfmpeg, summaryMarkdown, noticeConfiguration } = require("../tools/verify-runtime.js");

const header = (config) => `ffmpeg version n7.1.1 Copyright (c) 2000-2025 the FFmpeg developers\nbuilt with gcc 14\nconfiguration: ${config}\nlibavutil      59. 39.100 / 59. 39.100\n`;
const encoders = (...names) => ` V....D mpeg4                MPEG-4 part 2\n A....D aac                  AAC (Advanced Audio Coding)\n` +
  names.map((name) => ` V....D ${name.padEnd(20)} an encoder`).join("\n") + "\n";

test("an LGPL build with Media Foundation and hardware H.264 passes", () => {
  const result = analyzeFfmpeg({
    version: header("--disable-debug --enable-version3 --enable-shared --enable-nvenc --enable-amf --enable-libvpl --enable-mediafoundation"),
    encoders: encoders("h264_nvenc", "h264_qsv", "h264_amf", "h264_mf")
  });
  assert.equal(result.ok, true, result.problems.join("; "));
  assert.deepEqual(result.hardware, ["h264_nvenc", "h264_qsv", "h264_amf"]);
  assert.ok(result.h264.includes("h264_mf"));
});

test("a GPL build is rejected, with the reason", () => {
  const result = analyzeFfmpeg({
    version: header("--enable-gpl --enable-libx264 --enable-version3"),
    encoders: encoders("libx264", "h264_nvenc")
  });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => /--enable-gpl/.test(p)));
  assert.ok(result.problems.some((p) => /libx264/.test(p)));
});

test("a non-free build is rejected", () => {
  const result = analyzeFfmpeg({ version: header("--enable-nonfree --enable-libfdk-aac"), encoders: encoders("h264_mf") });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => /nonfree/.test(p)));
});

test("an LGPL build with no usable H.264 encoder is rejected", () => {
  const result = analyzeFfmpeg({ version: header("--disable-gpl"), encoders: encoders() });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => /no H.264 encoder/.test(p)));
});

test("output that is not FFmpeg is rejected", () => {
  assert.equal(analyzeFfmpeg({ version: "hello", encoders: "" }).ok, false);
});

test("a GPL encoder alone is caught even if the configure line looks clean", () => {
  const result = analyzeFfmpeg({ version: header("--disable-debug"), encoders: encoders("libx265", "h264_mf") });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => /libx265/.test(p)));
});

test("the checker flags this machine's distro FFmpeg, which is GPL", { skip: process.platform === "win32" }, () => {
  const { spawnSync } = require("node:child_process");
  const version = spawnSync("ffmpeg", ["-hide_banner", "-version"], { encoding: "utf8" });
  if (version.status !== 0) return; // no ffmpeg here; nothing to check
  const encodersOut = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout;
  const result = analyzeFfmpeg({ version: version.stdout, encoders: encodersOut });
  if (/--enable-gpl/.test(version.stdout)) assert.equal(result.ok, false, "a GPL distro build must not pass");
});

test("the report carries the exact version and configure line for the LGPL notice", () => {
  const config = "--disable-debug --enable-version3 --enable-libopenh264 --enable-nvenc";
  const result = analyzeFfmpeg({ version: header(config), encoders: encoders("h264_mf", "libopenh264") });
  assert.equal(result.configuration, config);
  assert.match(result.version, /^ffmpeg version n7\.1\.1/);
  const markdown = summaryMarkdown(result, "streamlink 8.6.3");
  assert.ok(markdown.includes(config), "the configure line is in the CI summary verbatim");
  assert.ok(markdown.includes("`libopenh264`"));
  assert.ok(markdown.includes("streamlink 8.6.3"));
});

test("the summary still renders when the build reports nothing", () => {
  const markdown = summaryMarkdown(analyzeFfmpeg({ version: "", encoders: "" }), "");
  assert.ok(markdown.includes("(not reported)"));
  assert.ok(markdown.includes("not found"));
});

test("the configure line is read from the notice's fenced block", () => {
  const md = "intro\n\nConfigure line, verbatim:\n\n```\n--a --b=1 --c\n```\n\nmore text\n```\nnot this\n```\n";
  assert.equal(noticeConfiguration(md), "--a --b=1 --c");
  assert.equal(noticeConfiguration("no block here"), "");
});

test("the real notice has a configure line that passes the LGPL rules", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const documented = noticeConfiguration(fs.readFileSync(path.join(__dirname, "..", "docs", "THIRD_PARTY_NOTICES.md"), "utf8"));
  assert.ok(documented.length > 500, "the notice quotes a configure line");
  const result = analyzeFfmpeg({ version: header(documented), encoders: encoders("h264_mf", "libopenh264") });
  assert.equal(result.ok, true, result.problems.join("; "));
  for (const flag of ["--enable-version3", "--enable-libopenh264", "--disable-libx264", "--disable-libx265", "--disable-libxvid"]) {
    assert.ok(documented.split(/\s+/).includes(flag), `${flag} is in the notice`);
  }
  assert.equal(/--enable-(gpl|nonfree)\b/.test(documented), false);
});
