const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

test("stdin 'stop' command shuts the recorder down cleanly", async () => {
  const child = spawn(process.execPath, [path.join(__dirname, "..", "background.cjs"), "some_channel"], {
    env: { ...process.env, CHATCLIP_COMMANDS: "1", CHATCLIP_EVENTS: "1", CHATCLIP_KEYCHAIN: "0",
      CHATCLIP_INPUT: "/nonexistent.mp4",
      CHATCLIP_STATE: require("node:os").tmpdir() + "/hd-cmd-state", CHATCLIP_OUTPUT: require("node:os").tmpdir() + "/hd-cmd-out" },
    stdio: ["pipe", "ignore", "ignore"]
  });
  const exit = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
  setTimeout(() => child.stdin.write("stop\n"), 800);
  const code = await Promise.race([exit, new Promise((r) => setTimeout(() => r("timeout"), 10000))]);
  if (code === "timeout") child.kill("SIGKILL");
  assert.equal(code, 0);
});
