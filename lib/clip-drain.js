"use strict";

// On stop, quit or update, a clip that is waiting or still exporting should be
// finished instead of dropped. This waits for it, but never for longer than
// timeoutMs, and reports a clip that could not be finished.

const CLIP_DRAIN_MS = 20000;

async function drainClips({ hasPending, getExport, flush, onUnfinished, timeoutMs = CLIP_DRAIN_MS } = {}) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); });
  try {
    const work = (async () => {
      if (!getExport() && hasPending()) await flush();
      const running = getExport();
      if (running) await running;
      return "done";
    })().catch(() => "done");
    const outcome = await Promise.race([work, timeout]);
    if (outcome === "timeout" || hasPending() || getExport()) {
      onUnfinished("The recorder stopped before this highlight was finished.");
      return false;
    }
    return true;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { drainClips, CLIP_DRAIN_MS };
