const test = require("node:test");
const assert = require("node:assert/strict");
const { confirmClose, CLOSE_DIALOG } = require("../main/close-guard.js");

test("closing asks first while a capture is running or winding down", () => {
  for (const phase of ["starting", "buffering", "recording", "exporting", "stopping"]) assert.equal(confirmClose({ phase }), true, phase);
});

test("closing is silent when idle, when already quitting, or in the self-test", () => {
  assert.equal(confirmClose({ phase: "idle" }), false);
  assert.equal(confirmClose({ phase: "error" }), false);
  assert.equal(confirmClose({ phase: "recording", quitting: true }), false);
  assert.equal(confirmClose({ phase: "recording", skip: true }), false);
  assert.equal(confirmClose({}), false);
});

test("the safe button is the default and the cancel choice", () => {
  assert.equal(CLOSE_DIALOG.buttons[CLOSE_DIALOG.defaultId], "Keep recording");
  assert.equal(CLOSE_DIALOG.cancelId, CLOSE_DIALOG.defaultId);
});
