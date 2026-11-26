// Maps Twitch "Get Channel Information" rows to their content classification labels
// (e.g. SexualThemes, ViolentGraphic, MatureGame), keyed by broadcaster id.
// Labels are channel-level and current, not per-clip: they describe how the streamer
// classifies their channel now.
export function labelsByBroadcaster(channels) {
  const out = new Map()
  for (const ch of Array.isArray(channels) ? channels : []) {
    if (!ch || typeof ch.broadcaster_id !== 'string') continue
    const labels = Array.isArray(ch.content_classification_labels)
      ? ch.content_classification_labels.filter((l) => typeof l === 'string')
      : []
    out.set(ch.broadcaster_id, labels)
  }
  return out
}
