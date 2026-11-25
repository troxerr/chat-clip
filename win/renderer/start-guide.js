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
  // actions are "buy" (open checkout) and "key" (open Settings to paste a key).
  function licenseBanner(license) {
    if (!license || !license.required) return null;
    if (license.mode === "trial") return { kind: "info", text: `Trial: ${license.daysLeft} day${license.daysLeft === 1 ? "" : "s"} left.`, actions: ["buy"] };
    if (license.mode === "expired") return { kind: "error", text: license.message, actions: ["buy", "key"] };
    if (license.mode === "licensed-unverified" || license.keyUnreadable) return { kind: "info", text: license.message, actions: [] };
    return null;
  }

  // Price is the build's priceLabel (win/build-config.json). A build with no
  // price still says "Buy a license" rather than inventing one.
  function buyLabel(license) {
    const price = String(license && license.priceLabel || "").trim();
    return price ? `Buy for ${price}` : "Buy a license";
  }

  // Buttons the Capture banner should show. Checkout stays hidden when this
  // build has no purchase URL.
  function bannerButtons(license) {
    const banner = licenseBanner(license);
    if (!banner) return [];
    const checkout = String(license && license.checkoutUrl || "").trim();
    const buttons = [];
    for (const action of banner.actions || []) {
      if (action === "buy") {
        if (!checkout) continue;
        buttons.push({ action: "buy", label: buyLabel(license) });
      } else if (action === "key") {
        buttons.push({ action: "settings", label: "Enter license key" });
      }
    }
    return buttons;
  }

  const api = { channelProblem, startBlocker, licenseBanner, buyLabel, bannerButtons };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.StartGuide = api;
})(typeof window !== "undefined" ? window : globalThis);
