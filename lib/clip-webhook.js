"use strict";

const { pathToFileURL } = require("node:url");

function clipPayload(event, metadata, { localPath, cloudUrl } = {}) {
  if (!metadata?.id || !metadata.channel) return null;
  return {
    version: 1,
    event,
    clipId: metadata.id,
    channel: metadata.channel,
    timestamp: metadata.detectedAt || metadata.createdAt,
    spikeScore: Number.isFinite(metadata.score) ? metadata.score : null,
    aspect: metadata.vertical ? "9:16" : "16:9",
    preset: metadata.vertical?.layout || null,
    localUrl: localPath ? pathToFileURL(localPath).href : null,
    cloudUrl: cloudUrl && /^https:\/\//i.test(cloudUrl) ? cloudUrl : null
  };
}

module.exports = { clipPayload };
