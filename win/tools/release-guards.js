"use strict";

// Safety checks the Windows release workflow runs on tag builds. Plain Node so they can be
// unit-tested without a Windows runner (see win/test/release-guards.test.js).
//
//   node win/tools/release-guards.js tag <tag>
//       The tag must be win-v<version in win/package.json>.
//   node win/tools/release-guards.js not-published <feed base url> <installer file name>
//       Refuses to upload an installer whose name is already on the feed: overwriting it would
//       change the sha512 that clients may already have cached.
//   node win/tools/release-guards.js verify <feed base url> <dist dir>
//       After the upload, the live latest.yml and installer must match the build exactly.
//
// Problems print as GitHub ::error:: lines and exit 1.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const trimBase = (base) => String(base || "").replace(/\/+$/, "");

function checkTagMatchesVersion(tag, version) {
  const expected = `win-v${version}`;
  if (tag === expected) return [];
  return [`Tag "${tag}" does not match the app version ${version} in win/package.json (expected "${expected}"). Bump the version first, or run the workflow manually for a test build.`];
}

// latest.yml is small and regular (electron-builder generic provider); no YAML library needed.
function parseLatestYml(text) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  const out = { version: "", path: "", files: [] };
  let current = null;
  for (const line of lines) {
    const top = line.match(/^(version|path):\s*(\S+)/);
    if (top) { out[top[1]] = top[2]; current = null; continue; }
    const url = line.match(/^\s*-\s*url:\s*(\S+)/);
    if (url) { current = { url: url[1], sha512: "", size: 0 }; out.files.push(current); continue; }
    const field = current && line.match(/^\s+(sha512|size):\s*(\S+)/);
    if (field) current[field[1]] = field[1] === "size" ? Number(field[2]) : field[2];
    else if (/^\S/.test(line)) current = null;
  }
  return out;
}

async function notPublished({ base, name, fetchImpl = fetch }) {
  const url = `${trimBase(base)}/${name}`;
  let status;
  try {
    status = (await fetchImpl(url, { method: "HEAD" })).status;
  } catch (error) {
    return [`Could not check whether ${name} is already published (${error.message}). Not uploading blind.`];
  }
  if (status === 404) return [];
  if (status === 200) return [`${name} is already published at ${url}. Releases are immutable: bump the version instead of re-releasing.`];
  return [`Unexpected HTTP ${status} while checking ${url}. Not uploading blind.`];
}

async function verifyFeed({ base, distDir, fetchImpl = fetch, attempts = 6, delayMs = 5000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const root = trimBase(base);
  const local = parseLatestYml(fs.readFileSync(path.join(distDir, "latest.yml"), "utf8"));
  const entry = local.files[0];
  if (!local.version || !entry || !entry.sha512 || !entry.size) return ["The local latest.yml is missing its version, installer, sha512 or size."];

  // The feed file is replaced last, so allow a short while for it to become visible.
  let liveProblems = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    liveProblems = [];
    try {
      const res = await fetchImpl(`${root}/latest.yml?cb=${Date.now()}`, { headers: { "cache-control": "no-cache" } });
      if (res.status !== 200) liveProblems.push(`latest.yml returned HTTP ${res.status}.`);
      else {
        const live = parseLatestYml(await res.text());
        const liveEntry = live.files[0] || {};
        if (live.version !== local.version) liveProblems.push(`Live latest.yml says version ${live.version || "(none)"}, expected ${local.version}.`);
        if (liveEntry.url !== entry.url) liveProblems.push(`Live latest.yml points at ${liveEntry.url || "(nothing)"}, expected ${entry.url}.`);
        if (liveEntry.sha512 !== entry.sha512) liveProblems.push("Live latest.yml has a different sha512 than the build.");
        if (liveEntry.size !== entry.size) liveProblems.push(`Live latest.yml says size ${liveEntry.size}, expected ${entry.size}.`);
      }
    } catch (error) {
      liveProblems.push(`Could not fetch latest.yml (${error.message}).`);
    }
    if (!liveProblems.length) break;
    if (attempt < attempts) await sleep(delayMs);
  }
  if (liveProblems.length) return liveProblems;

  // The installer itself: byte count and sha512 of what a client would actually download.
  try {
    const res = await fetchImpl(`${root}/${entry.url}`);
    if (res.status !== 200) return [`${entry.url} returned HTTP ${res.status}.`];
    const hash = crypto.createHash("sha512");
    let bytes = 0;
    for await (const chunk of res.body) { hash.update(chunk); bytes += chunk.length; }
    const problems = [];
    if (bytes !== entry.size) problems.push(`Downloaded ${entry.url} is ${bytes} bytes, latest.yml says ${entry.size}.`);
    if (hash.digest("base64") !== entry.sha512) problems.push(`Downloaded ${entry.url} does not match the sha512 in latest.yml.`);
    return problems;
  } catch (error) {
    return [`Could not download ${entry.url} to verify it (${error.message}).`];
  }
}

async function main(argv) {
  const [mode, a, b] = argv;
  let problems;
  if (mode === "tag") problems = checkTagMatchesVersion(a, require("../package.json").version);
  else if (mode === "not-published") problems = await notPublished({ base: a, name: b });
  else if (mode === "verify") problems = await verifyFeed({ base: a, distDir: b });
  else { console.error("usage: release-guards.js tag <tag> | not-published <base> <name> | verify <base> <dist dir>"); return 2; }
  if (problems.length) {
    for (const p of problems) console.error(`::error::${p}`);
    return 1;
  }
  console.log(`release guard "${mode}" passed.`);
  return 0;
}

if (require.main === module) main(process.argv.slice(2)).then((code) => process.exit(code), (error) => { console.error(`::error::${error.message}`); process.exit(1); });

module.exports = { checkTagMatchesVersion, parseLatestYml, notPublished, verifyFeed };
