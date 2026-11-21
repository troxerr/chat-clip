const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSettings, PERMISSION_VERSION } = require("../main/settings.js");
const { createClips } = require("../main/clips.js");
const { createJobStore } = require("../../lib/jobstore.js");
const feedback = require("../../lib/feedback.js");

test("settings start empty, merge into the shared config, and keep unrelated sections", () => {
  let config = { reframe: { blur: 30 }, license: { instance: "i" } };
  const s = createSettings({ readConfig: () => JSON.parse(JSON.stringify(config)), writeConfig: (c) => { config = c; }, outputFolder: "C:\\Users\\a\\Videos\\ChatClip", now: () => new Date("2026-11-18T10:00:00Z") });
  assert.deepEqual(s.get(), { launchAtLogin: false, permissionAcknowledged: false, permissionAt: "", outputFolder: "C:\\Users\\a\\Videos\\ChatClip" });
  assert.equal(s.set({ launchAtLogin: true }).launchAtLogin, true);
  assert.equal(config.reframe.blur, 30);
  assert.equal(config.license.instance, "i");
  assert.equal(config.app.launchAtLogin, true);
});

test("only known, correctly typed settings are accepted", () => {
  let config = {};
  const s = createSettings({ readConfig: () => config, writeConfig: (c) => { config = c; }, outputFolder: "x" });
  s.set({ launchAtLogin: "yes", evil: "../../x", outputFolder: "C:\\elsewhere" });
  assert.deepEqual(config, {});
  assert.equal(s.get().outputFolder, "x");
});

test("the permission acknowledgement is recorded once and expires if the wording version changes", () => {
  let config = {};
  const s = createSettings({ readConfig: () => config, writeConfig: (c) => { config = c; }, outputFolder: "x", now: () => new Date("2026-11-18T10:00:00Z") });
  assert.equal(s.get().permissionAcknowledged, false);
  const after = s.acknowledgePermission();
  assert.equal(after.permissionAcknowledged, true);
  assert.equal(after.permissionAt, "2026-11-18T10:00:00.000Z");
  assert.equal(config.app.permissionVersion, PERMISSION_VERSION);
  config = { app: { ...config.app, permissionVersion: PERMISSION_VERSION - 1 } };
  assert.equal(s.get().permissionAcknowledged, false, "an older wording must be accepted again");
});

function library() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hd-clips-"));
  const store = createJobStore({ stateDir: dir });
  const clipA = path.join(dir, "a-9x16.mp4"); fs.writeFileSync(clipA, "x");
  store.addHistory({ id: "a", channel: "streamer", createdAt: "2026-11-18T10:00:00Z", reason: "Chat spike", provider: "local", localPath: clipA, status: "saved" });
  store.addHistory({ id: "b", channel: "streamer", createdAt: "2026-11-18T11:00:00Z", reason: "Manual highlight", provider: "local", localPath: path.join(dir, "gone.mp4"), status: "saved" });
  const opened = [], shown = [];
  const clips = createClips({ jobStore: store, feedback, feedbackDir: dir, openPath: async (p) => { opened.push(p); return ""; }, showItem: (p) => shown.push(p) });
  return { dir, clips, opened, shown, clipA };
}

test("the library lists newest first, flags missing files, and has no rating at first", () => {
  const { clips, dir } = library();
  try {
    const list = clips.list();
    assert.deepEqual(list.map((c) => c.id), ["b", "a"]);
    assert.equal(list[0].available, false);
    assert.equal(list[1].available, true);
    assert.equal(list[1].rating, "");
    assert.equal(list[1].reason, "Chat spike");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("opening and revealing only work for clips in the history and only if the file exists", async () => {
  const { clips, opened, shown, clipA, dir } = library();
  try {
    await clips.open("a");
    clips.reveal("a");
    assert.deepEqual(opened, [clipA]);
    assert.deepEqual(shown, [clipA]);
    await assert.rejects(() => clips.open("b"), /file is missing/);
    await assert.rejects(() => clips.open("C:\\Windows\\System32\\calc.exe"), /no longer in the library/);
    assert.throws(() => clips.reveal("../../etc/passwd"), /no longer in the library/);
    assert.equal(opened.length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("an error from the operating system when opening is shown, not swallowed", async () => {
  const { dir, clipA } = library();
  try {
    const store = createJobStore({ stateDir: dir });
    const clips = createClips({ jobStore: store, feedback, feedbackDir: dir, openPath: async () => "No application is associated with the file.", showItem: () => {} });
    await assert.rejects(() => clips.open("a"), /No application is associated/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("ratings are recorded, shown, and cleared by pressing the same thumb again", () => {
  const { clips, dir } = library();
  try {
    assert.equal(clips.rate("a", "up"), "up");
    assert.equal(clips.rate("a", "down"), "down");
    assert.equal(clips.rate("a", "down"), "", "the same thumb twice clears it");
    assert.equal(clips.rate("a", "up"), "up");
    assert.equal(clips.rate("a", "clear"), "");
    assert.throws(() => clips.rate("a", "meh"), /Unknown rating/);
    assert.throws(() => clips.rate("zzz", "up"), /no longer in the library/);
    assert.equal(clips.list().find((c) => c.id === "b").rating, "");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
