"use strict";

// Closing the window ends the app, and with it the capture. When a capture is
// running (or winding down) the user is asked first.

const confirmClose = ({ phase, quitting = false, skip = false } = {}) => !skip && !quitting && Boolean(phase) && phase !== "idle" && phase !== "error";

const CLOSE_DIALOG = {
  type: "question",
  buttons: ["Keep recording", "Stop and close"],
  defaultId: 0,
  cancelId: 0,
  title: "ClipSpike is recording",
  message: "Closing ClipSpike stops the recording.",
  detail: "A highlight that is being saved will be finished first. Anything not yet saved is lost."
};

module.exports = { confirmClose, CLOSE_DIALOG };
