"use strict";

// What to tell the user when a highlight has been saved.

const path = require("node:path");

function clipSavedNotice(event = {}) {
  const file = event.path ? path.win32.basename(String(event.path).replace(/\//g, "\\")) : "";
  const where = event.provider && event.provider !== "local" && event.queued ? "It will upload shortly." : "Open the Clips page to watch it.";
  return {
    title: "Highlight saved",
    body: file ? `${file}. ${where}` : where,
    toast: "Highlight saved. See it on the Clips page."
  };
}

// An OS notification is for when the window is not in front.
const shouldNotifyOs = ({ windowFocused, disabled }) => !disabled && !windowFocused;

module.exports = { clipSavedNotice, shouldNotifyOs };
