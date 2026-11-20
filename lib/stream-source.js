"use strict";

function parseSource(input) {
  const value = String(input || "").trim().toLowerCase();
  let platform = "twitch";
  let slug = value;
  if (/^(?:https?:\/\/)?(?:www\.)?(?:kick\.com|twitch\.tv)\//.test(value)) {
    const url = new URL(/^https?:/.test(value) ? value : `https://${value}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Invalid stream URL.");
    platform = url.hostname.replace(/^www\./, "") === "kick.com" ? "kick" : "twitch";
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 1 || url.username || url.password) throw new Error("Use a live channel URL, not a clip or VOD URL.");
    slug = parts[0];
  } else if (value.startsWith("kick:")) {
    platform = "kick";
    slug = value.slice(5);
  }
  const pattern = platform === "kick" ? /^[a-z0-9_-]{1,25}$/ : /^[a-z0-9_]{1,25}$/;
  if (!pattern.test(slug)) throw new Error("Enter a Twitch username or a live twitch.tv/channel or kick.com/channel URL.");
  return { platform, slug, key: platform === "kick" ? `kick--${slug}` : slug,
    url: `https://${platform === "kick" ? "kick.com" : "twitch.tv"}/${slug}` };
}

module.exports = { parseSource };
