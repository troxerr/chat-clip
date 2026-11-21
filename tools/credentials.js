#!/usr/bin/env node
"use strict";

// Manage secrets in the Windows credential store (DPAPI).
//
//   node tools/credentials.js set google.refresh     # prompts (hidden) or reads stdin
//   node tools/credentials.js has google.refresh     # exit 0 if stored
//   node tools/credentials.js delete google.refresh
//   node tools/credentials.js list                   # names only, never values
//   node tools/credentials.js migrate [--config <file>]
//       move secrets out of the config file into the store
//
// There is deliberately no "get": printing a secret is never needed.

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { createCredentialStore } = require("../lib/credentials.js");
const { readConfig, resolveConfigPath } = require("../lib/appconfig.js");

// Config fields that hold secrets, and the credential name each one is stored under.
const CONFIG_SECRETS = [
  ["dropbox", "appSecret", "dropbox.appSecret"],
  ["dropbox", "refreshToken", "dropbox.refresh"],
  ["googleDrive", "clientSecret", "google.clientSecret"],
  ["googleDrive", "refreshToken", "google.refresh"],
  ["license", "key", "license.key"]
];

// Moves secrets from the config file into the store and blanks the config copy.
// A secret that cannot be stored stays in the config, so nothing is ever lost,
// and running it again is harmless (blank fields are skipped).
function migrateConfig(configPath, store) {
  const loaded = readConfig({ filePath: configPath });
  if (loaded.error) throw new Error(`Could not read ${configPath}: ${loaded.error}`);
  const config = loaded.config;
  const result = { path: configPath, moved: [], kept: [] };
  for (const [section, field, name] of CONFIG_SECRETS) {
    const value = config[section] && config[section][field];
    if (typeof value !== "string" || !value) continue;
    try {
      store.set(name, value);
      config[section][field] = "";
      result.moved.push(name);
    } catch (error) {
      result.kept.push({ name, error: error.message });
    }
  }
  if (result.moved.length) {
    const draft = `${configPath}.partial`;
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(draft, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(draft, configPath);
    try { fs.chmodSync(configPath, 0o600); } catch {}
  }
  return result;
}

function readSecret() {
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      let data = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { data += chunk; });
      process.stdin.on("end", () => resolve(data.replace(/\r?\n$/, "")));
    });
  }
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    const write = rl._writeToOutput;
    rl._writeToOutput = function (text) { if (!muted) write.call(rl, text); };
    rl.question("Secret (hidden): ", (answer) => { muted = false; rl.close(); process.stdout.write("\n"); resolve(answer); });
    muted = true;
  });
}

async function main(argv, store = createCredentialStore({ respectDisableFlag: false })) {
  const [command, account] = argv;
  if (!store.canWrite && command !== "list") {
    console.error(store.backend === "keychain"
      ? "On macOS, use the ClipSpike app to connect accounts; it saves tokens in Keychain."
      : "This platform has no credential store.");
    return 2;
  }
  switch (command) {
    case "set": {
      if (!account) { console.error("Usage: credentials set <name>"); return 2; }
      store.set(account, await readSecret());
      console.log(`Stored ${account}.`);
      return 0;
    }
    case "has": return account && store.has(account) ? 0 : 1;
    case "delete":
      if (!account) { console.error("Usage: credentials delete <name>"); return 2; }
      console.log(store.delete(account) ? `Deleted ${account}.` : `${account} was not stored.`);
      return 0;
    case "list":
      for (const name of store.list()) console.log(name);
      return 0;
    case "migrate": {
      // `migrate --config <file>`: the optional path arrives where a name would.
      const flag = argv.indexOf("--config");
      const configPath = flag >= 0 && argv[flag + 1] ? path.resolve(argv[flag + 1]) : resolveConfigPath(process.env);
      const result = migrateConfig(configPath, store);
      for (const name of result.moved) console.log(`Moved ${name} into the credential store.`);
      for (const item of result.kept) console.error(`Kept ${item.name} in ${configPath}: ${item.error}`);
      if (!result.moved.length && !result.kept.length) console.log("No secrets were found in the config file.");
      return result.kept.length ? 1 : 0;
    }
    default:
      console.error("Usage: credentials <set|has|delete|list|migrate> [name]");
      return 2;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => { console.error(error.message); process.exit(1); });
}

module.exports = { main, migrateConfig, CONFIG_SECRETS };
