const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { resolvePriority, applyPriority } = require("../lib/priority.js");

test("priority defaults to below normal on Windows only", () => {
  assert.equal(resolvePriority(undefined, {}, "win32"), "belowNormal");
  assert.equal(resolvePriority(undefined, {}, "darwin"), "normal");
  assert.equal(resolvePriority(undefined, {}, "linux"), "normal");
});

test("config and environment override the platform default, env first", () => {
  assert.equal(resolvePriority("normal", {}, "win32"), "normal");
  assert.equal(resolvePriority("belowNormal", {}, "darwin"), "belowNormal");
  assert.equal(resolvePriority("normal", { CLIPSPIKE_PRIORITY: "belowNormal" }, "darwin"), "belowNormal");
  assert.equal(resolvePriority("belowNormal", { CLIPSPIKE_PRIORITY: "normal" }, "win32"), "normal");
  assert.equal(resolvePriority("garbage", { CLIPSPIKE_PRIORITY: "garbage" }, "win32"), "belowNormal");
});

test("applyPriority only lowers priority when asked and never throws", () => {
  const calls = [];
  const setPriority = (pid, level) => calls.push([pid, level]);
  assert.equal(applyPriority({ pid: 42 }, "belowNormal", { env: {}, platform: "linux", setPriority }), true);
  assert.deepEqual(calls, [[42, os.constants.priority.PRIORITY_BELOW_NORMAL]]);
  assert.equal(applyPriority({ pid: 43 }, "normal", { env: {}, platform: "win32", setPriority }), false);
  assert.equal(applyPriority({}, "belowNormal", { env: {}, platform: "linux", setPriority }), false);
  assert.equal(applyPriority(null, "belowNormal", { env: {}, platform: "linux", setPriority }), false);
  const refuses = () => { throw new Error("EPERM"); };
  assert.equal(applyPriority({ pid: 44 }, "belowNormal", { env: {}, platform: "linux", setPriority: refuses }), false);
});

test("a real child process ends up with the lowered priority", async () => {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], { stdio: "ignore" });
  try {
    assert.equal(applyPriority(child, "belowNormal", { env: {}, platform: "linux" }), true);
    // Windows reports a coarse class; elsewhere it is the nice value.
    assert.ok(os.getPriority(child.pid) > os.getPriority(process.pid) ||
      os.getPriority(child.pid) === os.constants.priority.PRIORITY_BELOW_NORMAL);
  } finally {
    child.kill("SIGKILL");
  }
});
