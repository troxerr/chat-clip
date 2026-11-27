"use strict";

// Copies what the app needs into win/stage, keeping the repo's layout:
//   stage/package.json            (what electron-builder reads)
//   stage/background.cjs, lib/, dist/, tools/license.js   (the recorder)
//   stage/win/main, win/renderer, win/preload.js, win/build-config.json
//   stage/runtime/                (FFmpeg + Streamlink, fetched by tools/fetch-runtime-win.ps1)
// Fails if the runtime is missing, so an installer without video tools can never be built.

const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "..", "..");
const stage = path.resolve(__dirname, "..", "stage");
const winPkg = require("../package.json");

fs.rmSync(stage, { recursive: true, force: true });
const copy = (from, to = from) => {
  const source = path.join(repo, from);
  if (!fs.existsSync(source)) throw new Error(`Missing ${from}`);
  fs.cpSync(source, path.join(stage, to), { recursive: true });
};

fs.mkdirSync(stage, { recursive: true });
fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify({
  name: "clipspike", productName: winPkg.productName, version: winPkg.version,
  description: winPkg.description, author: winPkg.author, main: "win/main/main.js",
  dependencies: { "electron-updater": winPkg.dependencies["electron-updater"] }
}, null, 2));
// electron-builder packs node_modules from the app folder, so install the runtime dependency there.
require("node:child_process").execSync("npm install --omit=dev --ignore-scripts --no-audit --no-fund --no-package-lock", { cwd: stage, stdio: "inherit", shell: true });
copy("background.cjs"); copy("lib"); copy("dist");
fs.mkdirSync(path.join(stage, "tools"), { recursive: true });
copy("tools/license.js");
for (const item of ["main", "renderer", "preload.js", "build-config.json"]) copy(`win/${item}`);
copy("mac/icon-512.png", "icon.png");
copy("site/media/sample-highlight.mp4");

for (const bin of ["runtime/bin/ffmpeg.exe", "runtime/bin/ffprobe.exe"]) {
  if (!fs.existsSync(path.join(repo, bin))) throw new Error(`${bin} is missing. Run tools/fetch-runtime-win.ps1 first.`);
}
if (!fs.existsSync(path.join(repo, "runtime/streamlink/bin"))) throw new Error("runtime/streamlink is missing. Run tools/fetch-runtime-win.ps1 first.");
copy("runtime");
// Licence texts and the written offer ship with the installer.
copy("docs/THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md");
console.log(`staged ${stage}`);
