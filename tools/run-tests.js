#!/usr/bin/env node
"use strict";

// Cross-platform test runner: sets CHATCLIP_KEYCHAIN=0 (the
// `VAR=0 cmd` script prefix does not work in Windows cmd.exe) and runs
// node --test with the given files, defaulting to every test.
const { spawnSync } = require("node:child_process");

const files = process.argv.slice(2);
const result = spawnSync(process.execPath, ["--test", ...(files.length ? files : ["test/*.test.js", "win/test/*.test.js"])], {
  stdio: "inherit",
  env: { ...process.env, CHATCLIP_KEYCHAIN: "0" }
});
process.exit(result.status === null ? 1 : result.status);
