#!/usr/bin/env node
"use strict";

// Runs `node --check` on every JavaScript file in the engine, tools, apps and tests
// so new files are covered without editing package.json.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const skip = new Set(["node_modules", ".git", "web", "site", "docs", "stage", "dist", "vendor", "runtime", "build"]);
const ext = new Set([".js", ".cjs", ".mjs"]);
const files = [];

function walk(dir, top) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (skip.has(entry.name) && !(top && entry.name === "dist")) continue;
      if (entry.name.startsWith("build")) continue;
      walk(path.join(dir, entry.name), false);
    } else if (ext.has(path.extname(entry.name))) {
      files.push(path.join(dir, entry.name));
    }
  }
}
walk(root, true);

let failed = 0;
for (const file of files) {
  const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (r.status !== 0) {
    failed++;
    process.stderr.write(`${path.relative(root, file)}\n${r.stderr}\n`);
  }
}
console.log(`checked ${files.length} files, ${failed} failed`);
process.exit(failed ? 1 : 0);
