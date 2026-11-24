"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { checkTagMatchesVersion, parseLatestYml, notPublished, verifyFeed } = require("../tools/release-guards.js");

const BASE = "https://downloads.example.com/win/";
const installer = Buffer.from("pretend this is a 280 MB installer");
const sha = crypto.createHash("sha512").update(installer).digest("base64");
const latest = (over = {}) => `version: ${over.version || "0.1.3"}
files:
  - url: ClipSpike-0.1.3-x64.exe
    sha512: ${over.sha512 || sha}
    size: ${over.size || installer.length}
path: ClipSpike-0.1.3-x64.exe
sha512: ${over.sha512 || sha}
releaseDate: '2026-11-23T02:28:07.000Z'
`;

function feed(routes) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push(`${options.method || "GET"} ${url.replace(/\?cb=\d+/, "")}`);
    const route = routes[url.replace(/\?cb=\d+/, "")];
    const r = typeof route === "function" ? route() : route;
    if (r instanceof Error) throw r;
    if (!r) return { status: 404, text: async () => "", body: Readable.from([]) };
    return { status: r.status || 200, text: async () => r.text || "", body: Readable.from([r.bytes || Buffer.alloc(0)]) };
  };
  return { fetchImpl, calls };
}

function dist(yml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clipspike-dist-"));
  fs.writeFileSync(path.join(dir, "latest.yml"), yml);
  return dir;
}

test("the tag must be win-v plus the app version, so a test-suffixed or un-bumped tag is refused", () => {
  assert.deepEqual(checkTagMatchesVersion("win-v0.1.3", "0.1.3"), []);
  assert.match(checkTagMatchesVersion("win-v0.1.2", "0.1.3")[0], /expected "win-v0\.1\.3"/);
  assert.equal(checkTagMatchesVersion("win-v0.1.3-test", "0.1.3").length, 1);
});

test("latest.yml parses to its version, installer entry and path, ignoring the top-level sha512", () => {
  const parsed = parseLatestYml(latest().replace(/\n/g, "\r\n"));
  assert.equal(parsed.version, "0.1.3");
  assert.equal(parsed.path, "ClipSpike-0.1.3-x64.exe");
  assert.deepEqual(parsed.files, [{ url: "ClipSpike-0.1.3-x64.exe", sha512: sha, size: installer.length }]);
});

test("an installer name that is already on the feed is never uploaded again", async () => {
  const name = "ClipSpike-0.1.3-x64.exe";
  const url = `https://downloads.example.com/win/${name}`;
  assert.deepEqual(await notPublished({ base: BASE, name, fetchImpl: feed({ [url]: { status: 404 } }).fetchImpl }), []);
  assert.match((await notPublished({ base: BASE, name, fetchImpl: feed({ [url]: { status: 200 } }).fetchImpl }))[0], /already published/);
  assert.match((await notPublished({ base: BASE, name, fetchImpl: feed({ [url]: { status: 503 } }).fetchImpl }))[0], /Unexpected HTTP 503/);
  assert.match((await notPublished({ base: BASE, name, fetchImpl: feed({ [url]: new Error("offline") }).fetchImpl }))[0], /Not uploading blind/);
});

test("a matching live feed and installer pass", async () => {
  const { fetchImpl, calls } = feed({
    "https://downloads.example.com/win/latest.yml": { text: latest() },
    "https://downloads.example.com/win/ClipSpike-0.1.3-x64.exe": { bytes: installer }
  });
  assert.deepEqual(await verifyFeed({ base: BASE, distDir: dist(latest()), fetchImpl, sleep: async () => {} }), []);
  assert.deepEqual(calls, ["GET https://downloads.example.com/win/latest.yml", "GET https://downloads.example.com/win/ClipSpike-0.1.3-x64.exe"]);
});

test("a stale latest.yml is retried until the new one appears", async () => {
  let served = 0;
  const { fetchImpl } = feed({
    "https://downloads.example.com/win/latest.yml": () => ({ text: ++served < 3 ? latest({ version: "0.1.2" }) : latest() }),
    "https://downloads.example.com/win/ClipSpike-0.1.3-x64.exe": { bytes: installer }
  });
  assert.deepEqual(await verifyFeed({ base: BASE, distDir: dist(latest()), fetchImpl, sleep: async () => {} }), []);
  assert.equal(served, 3);
});

test("a feed that never shows the new version fails with what differs", async () => {
  const { fetchImpl } = feed({ "https://downloads.example.com/win/latest.yml": { text: latest({ version: "0.1.2" }) } });
  const problems = await verifyFeed({ base: BASE, distDir: dist(latest()), fetchImpl, attempts: 2, sleep: async () => {} });
  assert.match(problems.join("\n"), /says version 0\.1\.2, expected 0\.1\.3/);
});

test("an installer with the wrong bytes or a missing file fails even when latest.yml is right", async () => {
  const yml = { "https://downloads.example.com/win/latest.yml": { text: latest() } };
  const corrupt = feed({ ...yml, "https://downloads.example.com/win/ClipSpike-0.1.3-x64.exe": { bytes: Buffer.from("x".repeat(installer.length)) } });
  const corruptProblems = await verifyFeed({ base: BASE, distDir: dist(latest()), fetchImpl: corrupt.fetchImpl, sleep: async () => {} });
  assert.match(corruptProblems.join("\n"), /does not match the sha512/);
  assert.doesNotMatch(corruptProblems.join("\n"), /bytes/, "same length, so only the hash differs");
  const short = feed({ ...yml, "https://downloads.example.com/win/ClipSpike-0.1.3-x64.exe": { bytes: installer.subarray(0, 5) } });
  assert.match((await verifyFeed({ base: BASE, distDir: dist(latest()), fetchImpl: short.fetchImpl, sleep: async () => {} })).join("\n"), /is 5 bytes/);
  const missing = feed(yml);
  assert.match((await verifyFeed({ base: BASE, distDir: dist(latest()), fetchImpl: missing.fetchImpl, sleep: async () => {} }))[0], /returned HTTP 404/);
});
