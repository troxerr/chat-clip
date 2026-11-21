#!/usr/bin/env node
/* Local-only usage audit for ClipSpike. Writes a Markdown report; sends nothing. */
require("../lib/legacy.js").mirrorLegacyEnv();
const fs = require("fs");
const path = require("path");
const os = require("os");

const HOME = os.homedir();
const pick = (current, ...legacy) => (fs.existsSync(current) ? current : legacy.find((p) => fs.existsSync(p)) || current);
const stateDir = process.env.CLIPSPIKE_STATE || pick(path.join(HOME, "Library/Application Support/ClipSpike"), path.join(HOME, "Library/Application Support/ChatClip"), path.join(HOME, "Library/Application Support/Highlight Desk"));
const clipsDir = process.env.CLIPSPIKE_CLIPS || pick(path.join(HOME, "Movies/ClipSpike"), path.join(HOME, "Movies/ChatClip"), path.join(HOME, "Movies/Highlight Desk"));
const outPath = process.argv[2] || path.join(process.cwd(), "USAGE_LOG.md");
const usagePath = path.join(stateDir, "usage.jsonl");
const historyPath = path.join(stateDir, "history.json");
const queuePath = path.join(stateDir, "queue.json");
const configPath = process.env.CLIPSPIKE_CONFIG || path.join(HOME, ".clipspike.json");

const readJson = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
};
const readJsonl = (p) => {
  try {
    return fs.readFileSync(p, "utf8").split(/\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch { return []; }
};
const fmtBytes = (n) => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
const pct = (n, d) => d ? `${Math.round((n / d) * 100)}%` : "0%";
const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const shortPath = (p) => String(p || "").replace(HOME, "~");
const iso = (d) => new Date(d).toISOString().replace(".000Z", "Z");
const now = new Date();

const pkg = readJson(path.join(process.cwd(), "package.json"), {});
const history = readJson(historyPath, []);
const queue = readJson(queuePath, []);
const usage = readJsonl(usagePath);
let config = readJson(configPath, {});
try { config = JSON.parse(JSON.stringify(config)); } catch {}
for (const k of ["dropbox", "googleDrive"]) {
  if (config[k]) for (const s of ["appSecret", "refreshToken", "clientSecret", "accessToken"]) if (config[k][s]) config[k][s] = "<redacted>";
}

function walk(dir, out = []) {
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else out.push(p);
    }
  } catch {}
  return out;
}
const clipFiles = walk(clipsDir).filter((p) => /\.(mp4|mov|json)$/i.test(p));
const sidecars = [];
for (const p of clipFiles.filter((p) => p.endsWith(".json"))) {
  try { sidecars.push({ path: p, data: JSON.parse(fs.readFileSync(p, "utf8")) }); } catch {}
}
const mp4s = clipFiles.filter((p) => /\.mp4$/i.test(p)).map((p) => ({ path: p, size: fs.statSync(p).size }));
const videos = mp4s.filter((v) => /-9x16\.mp4$/i.test(v.path));
const raw = mp4s.filter((v) => !/-9x16\.mp4$/i.test(v.path));

const sidecarRows = sidecars.map(({ path: p, data }) => ({
  file: path.basename(p),
  at: data.createdAt || (() => { try { return fs.statSync(p).mtime.toISOString(); } catch { return ""; } })(),
  reason: data.reason || "",
  trigger: data.trigger || "",
  duration: num(data.durationSec),
  participants: num(data.participants),
  reactions: num(data.reactions),
  messages: num(data.messages),
  score: num(data.score),
  reframed: data.reframed === true,
  provider: data.storage?.provider || "",
  remotePath: data.storage?.remotePath || "",
  localPath: data.storage?.localPath || "",
  deletedLocal: data.deletedLocal === true,
  size: num(data.storage?.size),
  reframeError: data.reframeError || data.error || "",
  storageError: data.storageError || data.storage?.error || ""
}));
const historyRows = (Array.isArray(history) ? history : []).map((e) => ({
  at: e.createdAt || "",
  reason: e.reason || "",
  provider: e.provider || "",
  localPath: e.localPath || "",
  remotePath: e.remotePath || "",
  status: e.status || "",
  deletedLocal: e.deletedLocal === true,
  webLink: e.webLink || ""
}));
// History and sidecars describe the same clip. Merge on remote/local path or sidecar stem.
const mergedClips = new Map();
const mergeKey = (c) => c.remotePath || c.localPath || c.file?.replace(/\.json$/i, "") || `${c.at}|${c.reason}`;
for (const row of historyRows) {
  const key = mergeKey(row);
  mergedClips.set(key, { ...row, source: "history" });
}
for (const row of sidecarRows) {
  const key = mergeKey(row);
  const previous = mergedClips.get(key) || {};
  mergedClips.set(key, {
    ...previous,
    ...row,
    at: previous.at || row.at || "",
    status: previous.status || row.status || "",
    provider: previous.provider || row.provider || "",
    reason: previous.reason || row.reason || "",
    source: previous.source === "history" ? "history+sidecar" : "sidecar"
  });
}
const allClips = [...mergedClips.values()];
const byProvider = {};
const byStatus = {};
for (const c of allClips) {
  byProvider[c.provider || "unknown"] = (byProvider[c.provider || "unknown"] || 0) + 1;
  byStatus[c.status || "unknown"] = (byStatus[c.status || "unknown"] || 0) + 1;
}
const errorEvents = usage.filter((e) => /error|failed|fatal|crash/i.test(e.event || ""));
const pageViews = usage.filter((e) => e.event === "page-view");
const pageCounts = {};
for (const e of pageViews) pageCounts[e.details?.page || "unknown"] = (pageCounts[e.details?.page || "unknown"] || 0) + 1;
const chatSamples = usage.filter((e) => e.event === "chat-sample" && e.details);
const liveSamples = chatSamples.filter((e) => e.details.joined || num(e.details.participants) > 0);
const triggeredSamples = liveSamples.filter((e) => e.details.trigger);
const scores = liveSamples.map((e) => num(e.details.score)).filter((n) => n > 0);
const thresholds = liveSamples.map((e) => num(e.details.threshold)).filter((n) => n > 0);
const participants = liveSamples.map((e) => num(e.details.participants)).filter((n) => n > 0);
const reactions = liveSamples.map((e) => num(e.details.reactions)).filter((n) => n > 0);
const clipParticipants = allClips.map((c) => num(c.participants)).filter((n) => n > 0);
const clipReactions = allClips.map((c) => num(c.reactions)).filter((n) => n > 0);
const clipScores = allClips.map((c) => num(c.score)).filter((n) => n > 0);
const clipMessages = allClips.map((c) => num(c.messages)).filter((n) => n > 0);
const reactionPerMessage = allClips.filter((c) => num(c.messages) > 0).map((c) => num(c.reactions) / num(c.messages));
const sessions = [];
let open = null;
for (const e of usage) {
  if (e.event === "capture-start") open = { start: e.at, channel: e.details?.channel || "" };
  if (e.event === "capture-exit" && open) {
    sessions.push({ ...open, end: e.at, clips: num(e.details?.clips) });
    open = null;
  }
}
const clipSizes = allClips.map((c) => c.size).filter((n) => n > 0).concat(videos.map((v) => v.size));
const sizes = clipSizes.filter((n) => n > 0);
const small = sizes.filter((n) => n < 8 * 1024 * 1024);
const large = sizes.filter((n) => n > 40 * 1024 * 1024);
const autoClips = allClips.filter((c) => /chat spike/i.test(c.reason) || c.trigger === "auto");
const sortedAuto = [...autoClips].sort((a, b) => String(a.at).localeCompare(String(b.at)));
const closePairs = [];
for (let i = 1; i < sortedAuto.length; i++) {
  const a = Date.parse(sortedAuto[i - 1].at), b = Date.parse(sortedAuto[i].at);
  if (Number.isFinite(a) && Number.isFinite(b) && b - a > 0 && b - a < 5 * 60 * 1000) closePairs.push({ a: sortedAuto[i - 1], b: sortedAuto[i], minutes: (b - a) / 60000 });
}

const bugs = [];
const improvements = [];
const optimizations = [];
const features = [];

if (queue.length) bugs.push(`**Upload queue is not empty** — ${queue.length} job(s) waiting. Check \`lastError\` before the next session.`);
if (errorEvents.length) bugs.push(`**${errorEvents.length} recorded error event(s)** — inspect the newest \`engine-error\`, \`clip-failed\`, or \`engine-fatal\` entries in \`usage.jsonl\`.`);
if (sidecarRows.some((c) => c.reframeError || c.storageError)) bugs.push("**A sidecar contains a reframe or storage error** — the clip may exist without a verified 9:16/remote copy.");
if (historyRows.some((c) => c.status !== "uploaded" && c.status !== "local")) bugs.push("**A history entry is neither uploaded nor local** — verify queue/retry behavior.");
const smallClips = allClips.filter((c) => num(c.size) > 0 && num(c.size) < 8 * 1024 * 1024);
if (sizes.length && small.length) bugs.push(`**${small.length} unusually small clip${small.length === 1 ? "" : "s"}** (${smallClips.map((c) => `${c.reason || c.file || "clip"} — ${fmtBytes(c.size)}`).join("; ")}). For 30-second 9:16 video, that can indicate a stalled frame, static scene, or encoder bitrate collapse.`);
if (closePairs.length) bugs.push(`**${closePairs.length} auto-clip pair(s) fired within 5 minutes** — review whether they are distinct moments or duplicate/near-duplicate triggers: ${closePairs.slice(0, 5).map((p) => `${p.a.reason || "clip"} → ${p.b.reason || "clip"} (${p.minutes.toFixed(1)} min)`).join("; ")}.`);
if (!usage.length) improvements.push("**No usage log yet.** Launch the app once with this build, then run the audit again to capture page views, sessions, and chat samples.");
if (!liveSamples.length) improvements.push("**No chat samples yet.** Chat thresholds/scores will appear here after a live capture with this build.");
if (allClips.length && historyRows.length) improvements.push("**History and sidecars are separate stores.** A clip can be present in one but not the other; reconcile by remote path and clip ID.");
if (!sessions.length) improvements.push("**No completed capture session in the usage log yet.** Start/stop once so the audit can measure session duration and clip yield.");
if (allClips.some((c) => c.deletedLocal)) improvements.push("**Local cleanup is aggressive.** Most clips are remote-only; a failed cloud account logout can leave no playable local fallback. Consider keeping the newest 3–5 clips locally.");
if (byProvider.dropbox && config.googleDrive && !config.googleDrive.clientId) improvements.push("**Dropbox is active; Google Drive is not configured.** The destination cards imply parity, but only Dropbox has credentials.");
if (config.storage?.mode === "dropbox" && config.storage?.keepLocalCopy === 0) improvements.push("**`keepLocalCopy` is off** while uploads are the only durable copy. This is efficient but risky on upload failure.");

optimizations.push("Use **chat message rate + unique participants** as two independent signals. The current trigger is driven by participants with a reaction-count floor; a raid can inflate participants without a genuine reaction spike.");
optimizations.push("Add a **short-term vs long-term baseline** (30–60 s vs 15–30 min). The current `paceHistory` is a single recent window series, so a long slow build can look normal while a sudden burst is missed.");
optimizations.push("Weight **emotes and repeated messages** differently from unique chatters, and require a minimum of *new* messages, not just unique reactors.");
optimizations.push("Add **per-channel profiles** (small / medium / large chat). A global `minParticipants` and `minReactions` will over-trigger in small chats and under-trigger in large ones.");
optimizations.push("Suppress **near-duplicate clips** for 3–5 minutes per channel, or merge them into one longer clip. The current 90-second cooldown is short for a sustained hype wave.");
optimizations.push("Rank clips by a **quality score** (score, reactions/message, emote diversity, audio peak) and auto-discard low-quality exports before upload.");
optimizations.push("Log **encoder output size and bitrate** per clip. The current size spread is large; a 6–7 MB clip may be a static or failed frame path.");
optimizations.push("Persist **engine stderr/exit reason** in the usage log. The UI currently stores only the latest error string; a crash after a session leaves little evidence.");
optimizations.push("Add **session-level counters** (messages, unique chatters, triggers, accepted clips). This makes tuning possible without storing every chat message.");
optimizations.push("Review **upload retry backoff and queue visibility**. Queue is empty now, but the UI should show the next retry time and last error, not just a count.");

features.push("**Live chat activity panel** in Capture: messages/min, unique chatters, current score, threshold, and a sparkline of the last 15 minutes.");
features.push("**Sensitivity presets** (Conservative / Balanced / Aggressive) plus per-channel overrides, with a live preview of what would have triggered.");
features.push("**Clip review queue** with Good / Bad / Delete; feed ratings back into per-channel scoring and cooldown.");
features.push("**Raid / host / hype-train detection** as explicit trigger reasons, separate from organic chat spikes.");
features.push("**Auto-caption and brand templates** per channel: caption style, logo, safe-zone crop, intro/outro.");
features.push("**Multi-destination upload** with a primary + backup destination and local fallback.");
features.push("**Clip retention rules** (keep newest N, keep starred, delete after days) and a storage usage meter.");
features.push("**Discord/Slack webhook** or local notification when a clip is ready, with a link to review.");
features.push("**Per-channel analytics** (clips per hour, best-performing triggers, upload success rate) for done-for-you clipping.");
features.push("**Local-first privacy mode**: chat samples and diagnostics stay on-device with an explicit export button.");

const markdown = `# ClipSpike Usage Log

Generated **${iso(now)}** by \`tools/usage-audit.js\`. Local-only; no data was uploaded.

## Snapshot

| Item | Value |
|---|---|
| App version | ${(usage[0]?.version || pkg.version || "unknown")} (build ${(usage[0]?.build || "unknown")}) |
| State directory | \`${shortPath(stateDir)}\` |
| Clips directory | \`${shortPath(clipsDir)}\` |
| History rows | ${historyRows.length} |
| Sidecars | ${sidecarRows.length} |
| Rendered 9:16 files present | ${videos.length} |
| Raw/intermediate files present | ${raw.length} |
| Total local media | ${fmtBytes(mp4s.reduce((a, v) => a + v.size, 0))} |
| Queue jobs | ${queue.length} |
| Usage events | ${usage.length} |
| Chat samples | ${liveSamples.length} |
| Capture sessions in log | ${sessions.length} |
| Storage mode | ${config.storage?.mode || "unknown"} |
| Dropbox configured | ${config.dropbox?.appKey ? "yes" : "no"} |
| Google Drive configured | ${config.googleDrive?.clientId ? "yes" : "no"} |

## Clip and detection summary

- Providers: ${Object.entries(byProvider).map(([k, v]) => `${k} ${v}`).join(" · ") || "none"}
- History statuses: ${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(" · ") || "none"}
- Auto/chat-spike clips: **${autoClips.length}**
- Clip participants: median **${Math.round(median(clipParticipants))}**, min **${clipParticipants.length ? Math.min(...clipParticipants) : 0}**, max **${clipParticipants.length ? Math.max(...clipParticipants) : 0}**
- Clip reactions: median **${Math.round(median(clipReactions))}**, min **${clipReactions.length ? Math.min(...clipReactions) : 0}**, max **${clipReactions.length ? Math.max(...clipReactions) : 0}**
- Clip scores: median **${median(clipScores).toFixed(2)}**, min **${clipScores.length ? Math.min(...clipScores).toFixed(2) : 0}**, max **${clipScores.length ? Math.max(...clipScores).toFixed(2) : 0}**
- Messages at trigger: median **${Math.round(median(clipMessages))}**, min **${clipMessages.length ? Math.min(...clipMessages) : 0}**, max **${clipMessages.length ? Math.max(...clipMessages) : 0}**
- Reactions per message: median **${reactionPerMessage.length ? median(reactionPerMessage).toFixed(2) : "n/a"}**
- Clip sizes: median **${fmtBytes(median(sizes))}**, min **${sizes.length ? fmtBytes(Math.min(...sizes)) : "n/a"}**, max **${sizes.length ? fmtBytes(Math.max(...sizes)) : "n/a"}**
- Close auto pairs (<5 min): **${closePairs.length}**
- Page views: ${Object.entries(pageCounts).map(([k, v]) => `${k} ${v}`).join(" · ") || "none"}
- Triggered chat samples: **${triggeredSamples.length}** of ${liveSamples.length}

### Recent clips

${allClips.length ? allClips.slice().sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 8).map((c) => `- ${c.at || "unknown"} · **${c.reason || "highlight"}** · ${c.provider || "?"} · ${c.status || c.trigger || "?"}${c.participants ? ` · ${c.participants} participants` : ""}${c.reactions ? ` · ${c.reactions} reactions` : ""}${c.score ? ` · score ${c.score}` : ""}`).join("\n") : "- No clips recorded yet."}

## Bugs / risks

${bugs.length ? bugs.map((b) => `- ${b}`).join("\n") : "- No blocking bug found in the current state."}

## Key improvements

${improvements.length ? improvements.map((b) => `- ${b}`).join("\n") : "- No outstanding usability issue found."}

## Optimizations

${optimizations.map((b) => `- ${b}`).join("\n")}

## Potential features

${features.map((b) => `- ${b}`).join("\n")}

## Data quality notes

- The app stores **history** and **sidecars** separately. This audit merges them by remote/local path; if you see a clip only in one store, that is a reconciliation gap.
- ${videos.length ? "Local 9:16 files are available." : "No local 9:16 files are present in the clips folder; the current workflow uploads and deletes them."} Raw/intermediate media: ${raw.length} file(s), ${fmtBytes(raw.reduce((a, v) => a + v.size, 0))}.
- Usage log: ${usage.length ? `${usage.length} events, including ${liveSamples.length} chat samples.` : "not created yet — this app build writes it on launch."}
- Chat samples should be inspected after a live session; the current report's clip statistics come from sidecars.

## Chat-spike detection notes

The current detector evaluates **5-second windows** of unique participants and reactors. It uses a warmup of 12 windows, a 95th-percentile-capped median/MAD baseline, a threshold of \`max(minParticipants, median × 1.5, adaptive)\`, and a reaction floor of \`max(minReactions, participants × minReactionShare)\`. Auto-triggers have a 90-second cooldown.

This is a sensible baseline, but it measures **who showed up**, not **how much chat happened**. A raid can produce many unique participants with few messages; a dense, funny chat can produce many messages from a smaller group and still be missed. The best next step is to add \`messagesPerWindow\`, \`messagesPerMinute\`, and \`newChatterRatio\` to the score and show them live.

## Best next actions

1. **Add message-rate telemetry.** Before changing thresholds, log \`messagesPerWindow\`, \`messagesPerMinute\`, unique chatters, and emote counts for both triggered and non-triggered windows.
2. **Add per-channel profiles + longer dedupe.** One global threshold and a 90-second cooldown are too blunt for a mix of small and large chats.
3. **Keep the newest 3–5 local clips.** The current remote-only result is efficient, but a failed upload or expired Dropbox session leaves no editable copy.
4. **Review the 6.1 MB clip and the 10 close pairs.** They are the clearest current quality signals.

## How to keep this log current

\`\`\`sh
# After a capture session:
npm run usage:audit
\`\`\`

The app appends local events to \`usage.jsonl\` in the state directory. The audit rotates nothing itself; \`usage.jsonl\` rotates at 16 MB in the app. To include a snapshot in diagnostics, use the app's **Export Diagnostics** action.
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, markdown);
console.log(`Wrote ${outPath}`);
console.log(`History ${historyRows.length} · sidecars ${sidecarRows.length} · usage events ${usage.length} · chat samples ${liveSamples.length}`);
