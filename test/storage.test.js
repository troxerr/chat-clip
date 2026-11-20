const test = require("node:test");
const assert = require("node:assert/strict");
const { createStorageProvider, storageLabel } = require("../lib/storage/index.js");
const { storageSettings } = require("../lib/appconfig.js");

test("local storage needs no provider credentials", () => {
  const settings = storageSettings({ storage: { mode: "local" } }, {});
  const provider = createStorageProvider(settings);
  assert.equal(provider.provider, "local");
  assert.equal(provider.cloud, false);
  assert.equal(provider.uploadClip, undefined);
  assert.equal(storageLabel("local"), "Local only");
});

test("dropbox provider requires configuration", () => {
  const settings = storageSettings({ storage: { mode: "dropbox" } }, {});
  assert.throws(() => createStorageProvider(settings), /not configured/);
});

test("google drive provider requires configuration", () => {
  const settings = storageSettings({ storage: { mode: "googleDrive" } }, {});
  assert.throws(() => createStorageProvider(settings), /not configured/);
});

test("provider labels are user-facing", () => {
  assert.equal(storageLabel("dropbox"), "Dropbox");
  assert.equal(storageLabel("googleDrive"), "Google Drive");
  assert.equal(storageLabel("nope"), "Local only");
});
