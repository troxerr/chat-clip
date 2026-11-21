"use strict";

// Fails a release build when licensing would ship off or half-configured.
const config = require("../build-config.json");
const problems = [];
if (config.licenseRequired !== true) problems.push('"licenseRequired" must be true');
if (!String(config.productId || "").trim()) problems.push('"productId" is empty');
if (!/^https:\/\//.test(String(config.checkoutUrl || ""))) problems.push('"checkoutUrl" must be an https:// URL');
if (!(Number(config.trialDays) > 0)) problems.push('"trialDays" must be a positive number');
if (problems.length) {
  for (const p of problems) console.error(`::error file=win/build-config.json::${p}`);
  process.exit(1);
}
console.log("Licensing config OK.");
