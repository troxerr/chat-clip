"use strict";

// Development only: opens the real window against the stub bridge in Chromium
// and saves screenshots. Usage: node win/dev/screenshots.js <output dir>

const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");

const out = path.resolve(process.argv[2] || "win/dev/screenshots");
const index = "file://" + path.resolve(__dirname, "..", "renderer", "index.html");

const SHOTS = [
  ["capture-first-run", "?stub&scene=idle&page=capture"],
  ["capture-watching", "?stub&scene=watching&ack&page=capture"],
  ["capture-exporting", "?stub&scene=exporting&ack&page=capture"],
  ["capture-error", "?stub&scene=error&ack&page=capture"],
  ["capture-trial-expired", "?stub&scene=idle&ack&license=expired&page=capture"],
  ["clips", "?stub&scene=idle&ack&page=clips"],
  ["clips-empty", "?stub&scene=idle&ack&empty&page=clips"],
  ["settings-trial", "?stub&scene=idle&ack&license=trial&page=settings"],
  ["settings-licensed", "?stub&scene=idle&ack&license=licensed&page=settings"],
  ["settings-development", "?stub&scene=idle&ack&page=settings"]
];

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const problems = [];
  for (const scheme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 720 }, colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on("console", (m) => { if (m.type() === "error") problems.push(`${scheme} console: ${m.text()}`); });
    page.on("pageerror", (e) => problems.push(`${scheme} pageerror: ${e.message}`));
    for (const [name, query] of SHOTS) {
      await page.goto(index + query);
      await page.waitForFunction(() => window.__hdReady === true, null, { timeout: 5000 });
      await page.screenshot({ path: path.join(out, `${name}-${scheme}.png`) });
    }
    await context.close();
  }
  // Smallest supported window.
  const small = await browser.newContext({ viewport: { width: 760, height: 560 } });
  const sp = await small.newPage();
  sp.on("pageerror", (e) => problems.push(`small pageerror: ${e.message}`));
  await sp.goto(index + "?stub&scene=watching&ack&page=capture");
  await sp.waitForFunction(() => window.__hdReady === true);
  await sp.screenshot({ path: path.join(out, "capture-watching-min-size-light.png") });
  await browser.close();
  console.log(problems.length ? "PROBLEMS:\n" + problems.join("\n") : "no console errors");
  console.log(fs.readdirSync(out).length + " screenshots in " + out);
})().catch((e) => { console.error(e); process.exit(1); });
