"use strict";

// Fails a release build when licensing would ship off or half-configured.
// Sandbox Polar values only warn until CLIPSPIKE_REQUIRE_PRODUCTION_LICENSING=true (a repo variable, set at
// launch); from then on a sandbox or non-production endpoint fails the build, because real customers' keys
// would not activate against the sandbox.
const PRODUCTION_API = "https://api.polar.sh";

function check(config, env = {}) {
  const problems = [];
  const warnings = [];
  if (config.licenseRequired !== true) problems.push('"licenseRequired" must be true');
  if (!String(config.productId || "").trim()) problems.push('"productId" is empty');
  if (!/^https:\/\//.test(String(config.checkoutUrl || ""))) problems.push('"checkoutUrl" must be an https:// URL');
  if (!(Number(config.trialDays) > 0)) problems.push('"trialDays" must be a positive number');

  const production = String(env.CLIPSPIKE_REQUIRE_PRODUCTION_LICENSING || "").toLowerCase() === "true";
  const target = production ? problems : warnings;
  const api = String(config.apiBase || "").replace(/\/+$/, "");
  if (/sandbox/i.test(api) || /sandbox/i.test(String(config.checkoutUrl || ""))) {
    target.push('"apiBase"/"checkoutUrl" point at the Polar sandbox; licenses bought by real customers would not activate');
  } else if (production && api !== PRODUCTION_API) {
    problems.push(`"apiBase" must be ${PRODUCTION_API} for a production release`);
  }
  return { problems, warnings };
}

module.exports = { check, PRODUCTION_API };

if (require.main === module) {
  const { problems, warnings } = check(require("../build-config.json"), process.env);
  for (const w of warnings) console.warn(`::warning file=win/build-config.json::${w}`);
  if (problems.length) {
    for (const p of problems) console.error(`::error file=win/build-config.json::${p}`);
    process.exit(1);
  }
  console.log(warnings.length ? "Licensing config OK (sandbox values, allowed until production licensing is required)." : "Licensing config OK.");
}
