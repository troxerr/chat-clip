#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const feedback = require("../lib/feedback.js");
const policy = require("../lib/monitor-policy.js");
const { parseSource } = require("../lib/stream-source.js");

function formatReport(report) {
  const lines = [`#${report.channel} — ${report.ratedClips} rated clips across ${report.ratedSessions} completed live sessions`,
    `${report.windows} chat windows • tuning ${report.autoTune ? "automatic within limits" : "paused"}`,
    `Next capture profile: ${report.nextCapture?.version || report.profileVersion}`];
  if (report.staged) lines.push("Validated change staged. It applies on the next capture; this session stays unchanged.");
  if (report.candidate) {
    lines.push(`Candidate: ${report.candidate.name}`);
    lines.push(`Training utility: ${report.baseline.train.utility.toFixed(2)} → ${report.candidate.train.utility.toFixed(2)}`);
    lines.push(`Later-session utility: ${report.baseline.holdout.utility.toFixed(2)} → ${report.candidate.holdout.utility.toFixed(2)}`);
    lines.push(`Good moments retained in validation: ${Math.round(report.candidate.holdout.goodRecall * 100)}%`);
  }
  lines.push(...report.reasons);
  lines.push(`Boundary feedback: ${report.boundary["started-late"]} started late, ${report.boundary["ended-early"]} ended early. ${report.missed} missed-moment markers.`);
  lines.push("Rate clips in Clips. Right-click a clip for Duplicate / Started late / Ended early.");
  lines.push(report.limitation);
  return lines.join("\n");
}
function main(argv = process.argv.slice(2)) {
  const dir = feedback.feedbackDir();
  const input = argv.find(arg => !arg.startsWith("--")) || "";
  const channel = policy.channelKey(input.startsWith("kick--") ? input : parseSource(input).key);
  if (argv.includes("--pause")) policy.writeJson(path.join(dir, "monitoring", "preferences.json"), { autoTune: false });
  if (argv.includes("--resume")) policy.writeJson(path.join(dir, "monitoring", "preferences.json"), { autoTune: true });
  if (argv.includes("--rollback")) policy.rollback(dir, channel);
  const report = policy.evaluateChannel(dir, channel);
  report.autoTune = policy.prefs(dir).autoTune;
  report.staged = Boolean(report.autoTune && policy.stageProfile(dir, channel, report));
  report.nextCapture = policy.loadProfile(dir, channel);
  policy.writeJson(path.join(dir, "monitoring", "reports", `${channel}.json`), report);
  const liveDir = path.join(dir, "monitoring", "live");
  let live = [];
  try { live = fs.readdirSync(liveDir).filter(n => n.endsWith(".json")).map(n => policy.readJson(path.join(liveDir, n))).filter(s => s?.channel === channel).sort((a, b) => b.at.localeCompare(a.at)); } catch {}
  report.latest = live[0] || null;
  console.log(argv.includes("--json") ? JSON.stringify(report, null, 2) : formatReport(report));
  return report;
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { main, formatReport };
