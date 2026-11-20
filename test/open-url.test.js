const test = require("node:test");
const assert = require("node:assert/strict");
const { browserCommand, openUrl } = require("../lib/open-url.js");

const oauth = "https://example.com/oauth2/auth?client_id=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A53683&state=x&scope=a%20b";

test("Windows opens the URL as a single rundll32 argument, never through cmd", () => {
  const { command, args } = browserCommand(oauth, "win32");
  assert.equal(command, "rundll32.exe");
  assert.equal(args.length, 2);
  assert.equal(args[0], "url.dll,FileProtocolHandler");
  assert.equal(args[1], oauth, "the & characters must survive intact");
});

test("macOS and Linux use open and xdg-open", () => {
  assert.deepEqual(browserCommand(oauth, "darwin"), { command: "open", args: [oauth] });
  assert.deepEqual(browserCommand(oauth, "linux"), { command: "xdg-open", args: [oauth] });
});

test("only http and https URLs are opened", () => {
  for (const bad of ["file:///C:/Windows/System32/calc.exe", "javascript:alert(1)", "calc.exe", "ms-msdt:/id", "", "C:\\Windows\\notepad.exe"]) {
    assert.throws(() => browserCommand(bad, "win32"), /URL/);
  }
});

test("openUrl launches detached, reports success, and never throws", () => {
  const seen = [];
  const spawnImpl = (command, args, options) => { seen.push({ command, args, options }); return { unref() { seen.push("unref"); }, on() {} }; };
  assert.equal(openUrl(oauth, { platform: "win32", spawnImpl }), true);
  assert.equal(seen[0].command, "rundll32.exe");
  assert.equal(seen[0].options.detached, true);
  assert.equal(seen[0].options.windowsHide, true);
  assert.equal(seen[1], "unref");
  assert.equal(openUrl("file:///etc/passwd", { platform: "linux", spawnImpl }), false);
  assert.equal(openUrl(oauth, { platform: "linux", spawnImpl: () => { throw new Error("ENOENT"); } }), false);
});
