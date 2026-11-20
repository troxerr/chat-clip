const test = require("node:test");
const assert = require("node:assert/strict");
const { parseVodUrl, parseTimestamp, formatTimestamp, fetchVodInfo, fetchChat } = require("../lib/twitch-vod.js");
const { scanChat } = require("../lib/vodscan.js");
const { parseArgs, clipStamp } = require("../vod.cjs");

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("parseVodUrl accepts common VOD link shapes", () => {
  assert.deepEqual(parseVodUrl("https://www.twitch.tv/videos/2281234567"), { id: "2281234567", startAt: null });
  assert.deepEqual(parseVodUrl("twitch.tv/videos/2281234567?t=1h2m3s"), { id: "2281234567", startAt: 3723 });
  assert.equal(parseVodUrl("https://m.twitch.tv/videos/2281234567").id, "2281234567");
  assert.equal(parseVodUrl("https://www.twitch.tv/somechannel/video/2281234567").id, "2281234567");
  assert.equal(parseVodUrl("2281234567").id, "2281234567");
  assert.equal(parseVodUrl("https://www.youtube.com/videos/2281234567"), null);
  assert.equal(parseVodUrl("https://www.twitch.tv/somechannel"), null);
  assert.equal(parseVodUrl(""), null);
});

test("timestamps parse and format", () => {
  assert.equal(parseTimestamp("1:02:03"), 3723);
  assert.equal(parseTimestamp("2:03"), 123);
  assert.equal(parseTimestamp("90"), 90);
  assert.equal(parseTimestamp("1h"), 3600);
  assert.equal(parseTimestamp("5m30s"), 330);
  assert.equal(parseTimestamp("nonsense"), null);
  assert.equal(formatTimestamp(3723), "1:02:03");
  assert.equal(formatTimestamp(65), "1:05");
  assert.equal(clipStamp(3723), "1h02m03s");
});

test("parseArgs reads options", () => {
  const options = parseArgs(["https://twitch.tv/videos/123456", "--top", "5", "--start", "10:00", "--end", "1:00:00", "--scan-only"]);
  assert.equal(options.url, "https://twitch.tv/videos/123456");
  assert.equal(options.top, 5);
  assert.equal(options.start, 600);
  assert.equal(options.end, 3600);
  assert.equal(options.scanOnly, true);
  assert.equal(options.full, false);
});

test("fetchVodInfo maps the GraphQL video", async () => {
  let sent = null;
  const fetchImpl = async (url, init) => {
    sent = { url, init };
    return jsonResponse({ data: { video: { id: "123456", title: "Ranked grind", lengthSeconds: 7200, createdAt: "2026-11-01T00:00:00Z", owner: { id: "99", login: "SomeStreamer", displayName: "SomeStreamer" } } } });
  };
  const info = await fetchVodInfo("123456", { fetchImpl });
  assert.equal(sent.url, "https://gql.twitch.tv/gql");
  assert.ok(sent.init.headers["Client-ID"]);
  assert.equal(info.channel, "somestreamer");
  assert.equal(info.channelId, "99");
  assert.equal(info.lengthSeconds, 7200);
});

test("fetchVodInfo explains a missing VOD", async () => {
  const fetchImpl = async () => jsonResponse({ data: { video: null } });
  await assert.rejects(fetchVodInfo("123456", { fetchImpl }), /not found/);
});

// Fake chat: one message every second for 600 seconds, pages of 50 from the requested offset.
function fakeChatServer(total = 600, pageSize = 50) {
  const all = Array.from({ length: total }, (_, i) => ({
    id: `c${i}`,
    commenter: { id: String(i % 37), login: `user${i % 37}`, displayName: `User${i % 37}` },
    contentOffsetSeconds: i,
    message: { fragments: [{ text: i % 5 ? "hello" : "KEKW", emote: i % 5 ? null : { emoteID: "1" } }] }
  }));
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const offset = body.variables.contentOffsetSeconds;
    calls.push(offset);
    const edges = all.filter((c) => c.contentOffsetSeconds >= offset).slice(0, pageSize).map((node) => ({ node }));
    const hasNextPage = all.some((c) => c.contentOffsetSeconds > (edges.length ? edges.at(-1).node.contentOffsetSeconds : offset));
    return jsonResponse({ data: { video: { comments: { edges, pageInfo: { hasNextPage } } } } });
  };
  return { fetchImpl, calls };
}

test("fetchChat pages by offset across parallel slices without duplicates", async () => {
  const { fetchImpl, calls } = fakeChatServer();
  const progress = [];
  const comments = await fetchChat("123456", { start: 0, end: 600, workers: 2, fetchImpl, onProgress: (p) => progress.push(p) });
  assert.equal(comments.length, 600);
  assert.equal(new Set(comments.map((c) => c.id)).size, 600);
  assert.deepEqual(comments.slice(0, 3).map((c) => c.offset), [0, 1, 2]);
  assert.equal(comments[0].user, "user0");
  assert.deepEqual(comments[0].emotes, ["KEKW"]);
  assert.ok(calls.length >= 12 && calls.length < 40, `unexpected page count ${calls.length}`);
  assert.equal(progress.at(-1).fraction, 1);
});

test("fetchChat terminates when one second holds more messages than a page", async () => {
  const dense = Array.from({ length: 200 }, (_, i) => ({ id: `d${i}`, commenter: { login: `u${i}` }, contentOffsetSeconds: 10, message: { fragments: [{ text: "W" }] } }));
  const fetchImpl = async (url, init) => {
    const offset = JSON.parse(init.body).variables.contentOffsetSeconds;
    const edges = dense.filter((c) => c.contentOffsetSeconds >= offset).slice(0, 50).map((node) => ({ node }));
    return jsonResponse({ data: { video: { comments: { edges, pageInfo: { hasNextPage: offset < 10 } } } } });
  };
  const comments = await fetchChat("1234567", { start: 0, end: 60, fetchImpl });
  assert.ok(comments.length >= 50);
});

test("fetchChat surfaces GraphQL errors", async () => {
  const fetchImpl = async () => jsonResponse([{ errors: [{ message: "PersistedQueryNotFound" }] }]);
  await assert.rejects(fetchChat("123456", { start: 0, end: 30, fetchImpl }), /PersistedQueryNotFound/);
});

function syntheticChat({ length = 1800, spikes = [] }) {
  const comments = [];
  let n = 0;
  for (let t = 0; t < length; t += 1) {
    // Quiet baseline: about 3 chatters per 5-second window.
    if (t % 2 === 0) comments.push({ id: `b${n++}`, offset: t + 0.1, user: `regular${t % 7}`, text: "hi chat", emotes: [] });
  }
  for (const at of spikes) {
    for (let i = 0; i < 40; i += 1) {
      comments.push({ id: `s${n++}`, offset: at + (i % 5) * 0.9, user: `fan${i}`, text: i % 2 ? "KEKW KEKW" : "LMAO no way", emotes: i % 2 ? ["KEKW"] : [] });
    }
  }
  return comments;
}

test("scanChat finds spikes and ignores quiet chat", () => {
  const comments = syntheticChat({ spikes: [600, 1200] });
  const result = scanChat(comments, { start: 0, end: 1800 });
  assert.equal(result.total, 2);
  assert.deepEqual(result.moments.map((m) => Math.round(m.at)), [605, 1205]);
  assert.ok(result.moments[0].participants >= 40);
  assert.equal(result.moments[0].topEmotes[0].name, "KEKW");
  assert.equal(result.activity.length, 360);
  const signals = result.moments[0].signals;
  assert.ok(signals.chatterJump > 3, `jump ${signals.chatterJump}`);
  assert.equal(signals.chatters, result.moments[0].participants);
  assert.equal(signals.topMessage, "LMAO no way");
  assert.equal(signals.emoteDiversity, 1);
  assert.equal(typeof signals.strong, "boolean");

  const quiet = scanChat(syntheticChat({}), { start: 0, end: 1800 });
  assert.equal(quiet.total, 0);
});

test("scanChat keeps the strongest moments up to the limit, in time order", () => {
  const comments = syntheticChat({ length: 3600, spikes: [400, 900, 1500, 2100, 2700] });
  // Make the 2100 spike much stronger.
  for (let i = 0; i < 80; i += 1) comments.push({ id: `x${i}`, offset: 2100 + (i % 5) * 0.9, user: `big${i}`, text: "OMEGALUL", emotes: [] });
  const result = scanChat(comments, { start: 0, end: 3600, limit: 2 });
  assert.equal(result.strong, 5);
  assert.equal(result.total, 2);
  assert.equal(result.moments.length, 2);
  assert.ok(result.moments.some((m) => Math.round(m.at) === 2105));
  assert.ok(result.moments[0].at < result.moments[1].at);
});

test("scanChat keeps picks at least five minutes apart by default", () => {
  const comments = syntheticChat({ spikes: [600, 630, 840, 1000] });
  const result = scanChat(comments, { start: 0, end: 1800 });
  assert.equal(result.gapSec, 300);
  const times = result.moments.map((m) => m.at);
  for (let i = 1; i < times.length; i += 1) assert.ok(times[i] - times[i - 1] >= 300, `${times[i - 1]} and ${times[i]} are too close`);
  assert.equal(result.total, 2);
});

test("scanChat minGapSec can be shortened", () => {
  const comments = syntheticChat({ spikes: [600, 840] });
  assert.equal(scanChat(comments, { start: 0, end: 1800 }).total, 1);
  assert.equal(scanChat(comments, { start: 0, end: 1800, minGapSec: 120 }).total, 2);
});

test("scanChat keeps only the stronger of two strong spikes three minutes apart", () => {
  const comments = syntheticChat({ spikes: [600, 780] });
  for (let i = 0; i < 60; i += 1) comments.push({ id: `big${i}`, offset: 780 + (i % 5) * 0.9, user: `big${i}`, text: "OMEGALUL", emotes: [] });
  const result = scanChat(comments, { start: 0, end: 1800 });
  assert.ok(result.strong >= 2, `expected both spikes to be strong, got ${result.strong}`);
  assert.deepEqual(result.moments.map((m) => Math.round(m.at)), [785]);
});

test("scanChat still ranks moments on a loud channel where nothing clears the live threshold", () => {
  const comments = [];
  let n = 0;
  for (let t = 0; t < 1800; t += 0.2) comments.push({ id: `b${n++}`, offset: t, user: `u${n % 400}`, text: "chatting", emotes: [] });
  for (const at of [700, 1300]) {
    for (let i = 0; i < 10; i += 1) comments.push({ id: `m${n++}`, offset: at + (i % 5), user: `hype${at}-${i}`, text: "KEKW", emotes: ["KEKW"] });
  }
  const result = scanChat(comments, { start: 0, end: 1800, limit: 5 });
  assert.equal(result.strong, 0);
  assert.deepEqual(result.moments.map((m) => Math.round(m.at)), [705, 1305]);
  assert.equal(result.moments[0].strong, false);
});

test("scanChat uses chat before reportFrom only as a baseline", () => {
  const comments = syntheticChat({ spikes: [300, 1200] });
  const result = scanChat(comments, { start: 0, reportFrom: 600, end: 1800 });
  assert.deepEqual(result.moments.map((m) => Math.round(m.at)), [1205]);
  assert.equal(result.activity[0].at, 600);
});

test("parseArgs reads the gap, hook and captions flags", () => {
  const { parseArgs: parse } = require("../vod.cjs");
  const defaults = parse(["https://www.twitch.tv/videos/1"]);
  assert.equal(defaults.gap, 300);
  assert.equal(defaults.hook, false);
  assert.equal(defaults.captions, false);
  assert.equal(parse(["x", "--gap", "5"]).gap, 30);
  assert.equal(parse(["x", "--gap", "99999"]).gap, 1800);
  assert.equal(parse(["x", "--gap", "120"]).gap, 120);
  const options = parse(["x", "--hook", "--hook-text", "HE DID IT", "--captions"]);
  assert.equal(options.hook, true);
  assert.equal(options.hookText, "HE DID IT");
  assert.equal(options.captions, true);
});
