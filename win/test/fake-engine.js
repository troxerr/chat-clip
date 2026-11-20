// A stand-in for background.cjs for tests: speaks the same protocol.
// Behaviors are chosen with FAKE_ENGINE=<name>.
const mode = process.env.FAKE_ENGINE || "normal";
const out = (event) => process.stdout.write(JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n");
const channel = process.argv[2];

if (mode === "crash") {
  process.stderr.write("Missing streamlink. Install it with: winget install Streamlink.Streamlink\n");
  process.exit(1);
}
if (mode === "env") {
  out({ type: "ready", channel, env: { EVENTS: process.env.HIGHLIGHT_DESK_EVENTS, COMMANDS: process.env.HIGHLIGHT_DESK_COMMANDS, RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE || null, EXTRA: process.env.EXTRA || null } });
  setInterval(() => {}, 1000);
}
else if (mode === "deaf") {
  out({ type: "ready", channel });
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
} else {
  out({ type: "ready", channel });
  out({ type: "status", recording: true, joined: true, mediaTime: 5 });
  let buf = "";
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line === "save") { out({ type: "clip-requested", reason: "Manual highlight" }); out({ type: "clip-saved", path: "C:\\clips\\x.mp4" }); }
      if (line === "missed") out({ type: "missed-moment", message: "Marked." });
      if (line === "stop") { out({ type: "status", stopping: true, recording: false, joined: false }); process.exit(0); }
    }
  });
  process.stdin.on("end", () => process.exit(0));
}
