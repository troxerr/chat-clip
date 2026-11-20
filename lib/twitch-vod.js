"use strict";

// Twitch VOD metadata and chat replay over Twitch's public GraphQL endpoint.
// No account or OAuth: this is the same anonymous access the Twitch web player uses.

const GQL_URL = "https://gql.twitch.tv/gql";
const PUBLIC_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const COMMENTS_HASH = "b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a";

function parseTimestamp(value) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim().toLowerCase();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const colon = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/);
  if (colon) return Number(colon[1] || 0) * 3600 + Number(colon[2]) * 60 + Number(colon[3]);
  const units = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (units && (units[1] || units[2] || units[3])) {
    return Number(units[1] || 0) * 3600 + Number(units[2] || 0) * 60 + Number(units[3] || 0);
  }
  return null;
}

function formatTimestamp(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Accepts https://www.twitch.tv/videos/123, twitch.tv/videos/123?t=1h2m3s,
// m.twitch.tv/videos/123, twitch.tv/<channel>/video/123, or a bare numeric id.
function parseVodUrl(input) {
  const text = String(input || "").trim();
  if (/^\d{5,}$/.test(text)) return { id: text, startAt: null };
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!/(^|\.)twitch\.tv$/i.test(url.hostname)) return null;
  const match = url.pathname.match(/\/videos?\/(\d{5,})/);
  if (!match) return null;
  return { id: match[1], startAt: parseTimestamp(url.searchParams.get("t")) };
}

async function gql(body, { fetchImpl = fetch, retries = 4, timeoutMs = 15000 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, Math.min(8000, 500 * 2 ** attempt)));
    try {
      const response = await fetchImpl(GQL_URL, {
        method: "POST",
        headers: { "Client-ID": PUBLIC_CLIENT_ID, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`Twitch returned ${response.status}`);
        continue;
      }
      if (!response.ok) throw Object.assign(new Error(`Twitch returned ${response.status}`), { fatal: true });
      return await response.json();
    } catch (error) {
      if (error.fatal) throw error;
      lastError = error;
    }
  }
  throw lastError || new Error("Twitch request failed");
}

async function fetchVodInfo(id, options = {}) {
  const data = await gql({
    query: "query($id:ID!){video(id:$id){id title lengthSeconds createdAt owner{id login displayName}}}",
    variables: { id: String(id) }
  }, options);
  const video = data && data.data && data.data.video;
  if (!video) throw new Error("That VOD was not found. It may be deleted, subscriber-only, or still processing.");
  return {
    id: String(video.id),
    title: video.title || "",
    lengthSeconds: Number(video.lengthSeconds) || 0,
    createdAt: video.createdAt || null,
    channel: video.owner ? String(video.owner.login || "").toLowerCase() : "",
    channelName: video.owner ? video.owner.displayName || video.owner.login : "",
    channelId: video.owner ? String(video.owner.id || "") : ""
  };
}

function normalizeComment(node) {
  if (!node) return null;
  const fragments = (node.message && node.message.fragments) || [];
  const text = fragments.map((fragment) => fragment.text || "").join("");
  const emotes = fragments.filter((fragment) => fragment.emote).map((fragment) => (fragment.text || "").trim()).filter(Boolean);
  const user = node.commenter ? String(node.commenter.login || node.commenter.id || "") : "";
  return {
    id: String(node.id || ""),
    offset: Number(node.contentOffsetSeconds) || 0,
    user: user.toLowerCase(),
    name: node.commenter ? node.commenter.displayName || user : "",
    text,
    emotes
  };
}

async function fetchCommentPage(videoId, offset, options = {}) {
  const data = await gql({
    operationName: "VideoCommentsByOffsetOrCursor",
    variables: { videoID: String(videoId), contentOffsetSeconds: Math.max(0, Math.floor(offset)) },
    extensions: { persistedQuery: { version: 1, sha256Hash: COMMENTS_HASH } }
  }, options);
  const payload = Array.isArray(data) ? data[0] : data;
  if (payload && Array.isArray(payload.errors) && payload.errors.length) {
    throw new Error(`Twitch chat replay error: ${payload.errors[0].message || "unknown"}`);
  }
  const comments = payload && payload.data && payload.data.video && payload.data.video.comments;
  if (!comments) return { comments: [], hasNextPage: false };
  return {
    comments: (comments.edges || []).map((edge) => normalizeComment(edge && edge.node)).filter(Boolean),
    hasNextPage: Boolean(comments.pageInfo && comments.pageInfo.hasNextPage)
  };
}

// Pages through one slice of the VOD by content offset. Offset paging avoids the
// cursor path, which Twitch gates behind client integrity checks.
async function fetchSlice(videoId, start, end, options, seen, onPage) {
  const out = [];
  let offset = start;
  while (offset < end) {
    const page = await fetchCommentPage(videoId, offset, options);
    let last = offset;
    for (const comment of page.comments) {
      if (comment.offset >= end) continue;
      if (comment.offset < start) continue;
      last = Math.max(last, comment.offset);
      if (!comment.id || seen.has(comment.id)) continue;
      seen.add(comment.id);
      out.push(comment);
    }
    if (onPage) onPage(Math.min(end, last), out.length);
    if (!page.comments.length) {
      if (!page.hasNextPage) break;
      offset += 30;
      continue;
    }
    const maxOffset = Math.max(...page.comments.map((comment) => comment.offset));
    if (maxOffset >= end || !page.hasNextPage) break;
    // Move forward by at least one second so a burst denser than one page cannot loop.
    offset = Math.max(offset + 1, Math.floor(maxOffset));
  }
  return out;
}

async function fetchChat(videoId, {
  start = 0,
  end,
  workers = 8,
  onProgress,
  ...options
} = {}) {
  const from = Math.max(0, Math.floor(start));
  const to = Math.max(from + 1, Math.ceil(end));
  const sliceCount = Math.max(1, Math.min(workers, Math.ceil((to - from) / 300)));
  const size = Math.ceil((to - from) / sliceCount);
  const seen = new Set();
  const done = new Array(sliceCount).fill(0);
  const report = () => {
    if (!onProgress) return;
    const covered = done.reduce((sum, value) => sum + value, 0);
    onProgress({ fraction: Math.min(1, covered / (to - from)), comments: seen.size });
  };
  const slices = await Promise.all(Array.from({ length: sliceCount }, (_, index) => {
    const sliceStart = from + index * size;
    const sliceEnd = Math.min(to, sliceStart + size);
    return fetchSlice(videoId, sliceStart, sliceEnd, options, seen, (reached) => {
      done[index] = Math.max(0, reached - sliceStart);
      report();
    }).then((comments) => {
      done[index] = sliceEnd - sliceStart;
      report();
      return comments;
    });
  }));
  return slices.flat().sort((a, b) => a.offset - b.offset);
}

module.exports = {
  GQL_URL,
  PUBLIC_CLIENT_ID,
  parseTimestamp,
  formatTimestamp,
  parseVodUrl,
  fetchVodInfo,
  fetchCommentPage,
  fetchChat,
  normalizeComment
};
