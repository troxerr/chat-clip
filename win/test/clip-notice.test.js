const test = require("node:test");
const assert = require("node:assert/strict");
const { clipSavedNotice, shouldNotifyOs } = require("../main/clip-notice.js");

test("the notice names the saved file and says where to find it", () => {
  const n = clipSavedNotice({ path: "C:\\Users\\a\\ClipSpike\\clips\\abc-2026-raid.mp4" });
  assert.equal(n.title, "Highlight saved");
  assert.match(n.body, /abc-2026-raid\.mp4/);
  assert.match(n.toast, /Clips page/);
});

test("a clip without a path still gets a notice", () => {
  assert.match(clipSavedNotice({}).body, /Clips page/);
});

test("an OS notification is only for when the window is not focused and notifications are on", () => {
  assert.equal(shouldNotifyOs({ windowFocused: false, disabled: false }), true);
  assert.equal(shouldNotifyOs({ windowFocused: true, disabled: false }), false);
  assert.equal(shouldNotifyOs({ windowFocused: false, disabled: true }), false);
});
