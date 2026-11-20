const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const doc = fs.readFileSync(path.join(root, "docs", "ENGINE_PROTOCOL.md"), "utf8");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const emitted = (source) => new Set([...source.matchAll(/\bemit\("([a-z-]+)"/g)].map((m) => m[1]));
const documented = (name) => doc.includes("`" + name + "`");

test("every event the recorder emits is documented", () => {
  const names = emitted(read("background.cjs"));
  assert.ok(names.size > 10, "event extraction found too few events");
  const missing = [...names].filter((name) => !documented(name));
  assert.deepEqual(missing, [], `undocumented recorder events: ${missing.join(", ")}`);
});

test("every event the VOD tool emits is documented", () => {
  const names = emitted(read("vod.cjs"));
  assert.ok(names.size > 5);
  const missing = [...names].filter((name) => !documented(name));
  assert.deepEqual(missing, [], `undocumented VOD events: ${missing.join(", ")}`);
});

test("every stdin command is documented", () => {
  const block = read("background.cjs").match(/const commands = \{([\s\S]*?)\};/);
  assert.ok(block, "commands table not found in background.cjs");
  const commands = [...block[1].matchAll(/^\s*([a-z]+):/gm)].map((m) => m[1]);
  assert.deepEqual(commands.sort(), ["missed", "save", "stop"]);
  for (const name of commands) assert.ok(documented(name), `command ${name} is not documented`);
});

test("documented environment variables exist in the code", () => {
  const sources = [];
  for (const dir of [".", "lib", "tools"]) {
    for (const file of fs.readdirSync(path.join(root, dir))) {
      if (/\.(c?js)$/.test(file)) sources.push(read(path.join(dir, file)));
    }
  }
  const code = sources.join("\n");
  const names = [...doc.matchAll(/`(HIGHLIGHT_DESK_[A-Z_]+)(?:=[^`]*)?`/g)].map((m) => m[1]);
  assert.ok(names.length >= 6);
  for (const name of names) assert.ok(code.includes(name), `${name} is documented but not used in the code`);
});
