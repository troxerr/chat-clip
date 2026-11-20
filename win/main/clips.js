"use strict";

// The clip library: reads the history the recorder keeps, adds the user's
// ratings, and opens only files that history lists (never a path from the UI).

const fs = require("node:fs");

const RATING_ACTIONS = { up: "rated-up", down: "rated-down", clear: "rating-cleared" };

function createClips({ jobStore, feedback, feedbackDir, openPath, showItem, exists = fs.existsSync }) {
  function ratings() {
    const latest = new Map();
    let events = [];
    try { events = feedback.readEvents(feedbackDir); } catch {}
    for (const event of events) {
      if (event.kind !== "clip-action" || !event.clipId) continue;
      if (event.action === "rated-up") latest.set(event.clipId, "up");
      else if (event.action === "rated-down") latest.set(event.clipId, "down");
      else if (event.action === "rating-cleared") latest.delete(event.clipId);
    }
    return latest;
  }

  function list() {
    const rated = ratings();
    return jobStore.listHistory()
      .filter((entry) => entry && entry.id)
      .map((entry) => ({
        id: entry.id,
        channel: entry.channel || "",
        createdAt: entry.createdAt || "",
        reason: entry.reason || "Highlight",
        provider: entry.provider || "local",
        status: entry.status || "",
        localPath: entry.localPath || "",
        available: Boolean(entry.localPath) && exists(entry.localPath),
        rating: rated.get(entry.id) || ""
      }))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  function find(id) {
    const clip = list().find((item) => item.id === id);
    if (!clip) throw new Error("That clip is no longer in the library.");
    return clip;
  }

  function usable(id) {
    const clip = find(id);
    if (!clip.localPath || !clip.available) throw new Error("The clip file is missing. It may have been moved or deleted.");
    return clip;
  }

  async function open(id) {
    const clip = usable(id);
    const problem = await openPath(clip.localPath);
    if (problem) throw new Error(`Could not open the clip: ${problem}`);
    feedback.logClipAction({ clipId: id, action: "opened" }, { dir: feedbackDir });
    return true;
  }

  function reveal(id) {
    const clip = usable(id);
    showItem(clip.localPath);
    feedback.logClipAction({ clipId: id, action: "revealed" }, { dir: feedbackDir });
    return true;
  }

  function rate(id, rating) {
    const action = RATING_ACTIONS[rating];
    if (!action) throw new Error("Unknown rating.");
    find(id);
    const current = list().find((item) => item.id === id).rating;
    // Pressing the same thumb again clears it, as in the Mac app.
    const effective = rating !== "clear" && current === rating ? RATING_ACTIONS.clear : action;
    feedback.logClipAction({ clipId: id, action: effective }, { dir: feedbackDir });
    return list().find((item) => item.id === id).rating;
  }

  return { list, open, reveal, rate };
}

module.exports = { createClips, RATING_ACTIONS };
