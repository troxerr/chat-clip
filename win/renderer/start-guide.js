"use strict";

// Says why "Start capture" cannot be used yet, in plain words. Pure, so it is
// unit-tested; the window loads it as a plain script and the tests require it.
// The recorder checks the channel again, so this only has to be helpful.

(function (root) {
  const NAME = /^[A-Za-z0-9_]{3,25}$/;

  function channelProblem(input) {
    const text = String(input || "").trim();
    if (!text) return "";
    if (/^https?:\/\//i.test(text) || text.includes("/") || text.includes(".")) {
      if (/^(https?:\/\/)?(www\.|m\.)?twitch\.tv\/[A-Za-z0-9_]{3,25}\/?$/i.test(text)) return "";
      return /twitch\.tv/i.test(text) ? "Use a live channel link such as twitch.tv/username." : "This version records Twitch channels only.";
    }
    if (!NAME.test(text)) return "A Twitch username is 3 to 25 letters, numbers or underscores.";
    return "";
  }

  // Returns the reason Start is unavailable, or "" when it can be used.
  function startBlocker({ license, channel, ackNeeded = false, ack = false } = {}) {
    if (license && !license.valid) return license.message || "ClipSpike needs a license to capture.";
    const text = String(channel || "").trim();
    if (!text) return "Enter a Twitch channel to start.";
    const problem = channelProblem(text);
    if (problem) return problem;
    if (ackNeeded && !ack) return "Confirm that you have permission to record this channel.";
    return "";
  }

  // The Capture page banner: trial days, or what to do about a license.
  function licenseBanner(license) {
    if (!license || !license.required) return null;
    if (license.mode === "trial") return { kind: "info", text: `Trial: ${license.daysLeft} day${license.daysLeft === 1 ? "" : "s"} left.`, action: "buy" };
    if (license.mode === "expired") return { kind: "error", text: license.message, action: "settings" };
    if (license.mode === "licensed-unverified" || license.keyUnreadable) return { kind: "info", text: license.message, action: null };
    return null;
  }

  const api = { channelProblem, startBlocker, licenseBanner };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.StartGuide = api;
})(typeof window !== "undefined" ? window : globalThis);
