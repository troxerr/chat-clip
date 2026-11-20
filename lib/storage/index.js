"use strict";

const { createDropboxClient } = require("../dropbox.js");
const { createGoogleDriveClient } = require("../google-drive.js");
const { localProvider } = require("./local.js");

function createStorageProvider(settings, options = {}) {
  if (!settings || typeof settings !== "object") {
    throw new Error("Storage settings are missing.");
  }
  if (settings.mode === "local") return localProvider;
  if (settings.mode === "dropbox") {
    if (!settings.dropbox || !settings.dropbox.configured) {
      throw new Error("Dropbox is selected but not configured.");
    }
    return createDropboxClient(settings.dropbox, options);
  }
  if (settings.mode === "googleDrive") {
    if (!settings.googleDrive || !settings.googleDrive.configured) {
      throw new Error("Google Drive is selected but not configured.");
    }
    return createGoogleDriveClient(settings.googleDrive, options);
  }
  throw new Error(`Unknown storage mode: ${settings.mode}`);
}

function storageLabel(mode) {
  if (mode === "dropbox") return "Dropbox";
  if (mode === "googleDrive") return "Google Drive";
  return "Local only";
}

module.exports = {
  createStorageProvider,
  storageLabel,
  localProvider
};
