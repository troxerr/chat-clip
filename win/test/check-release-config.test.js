const test = require("node:test");
const assert = require("node:assert/strict");
const { check } = require("../tools/check-release-config.js");

const prod = { licenseRequired: true, trialDays: 7, apiBase: "https://api.polar.sh", productId: "p:b", checkoutUrl: "https://buy.polar.sh/x" };
const sandbox = { ...prod, apiBase: "https://sandbox-api.polar.sh", checkoutUrl: "https://sandbox-api.polar.sh/v1/checkout-links/x" };
const REQUIRE = { CLIPSPIKE_REQUIRE_PRODUCTION_LICENSING: "true" };

test("a production config passes with and without the production requirement", () => {
  assert.deepEqual(check(prod, {}), { problems: [], warnings: [] });
  assert.deepEqual(check(prod, REQUIRE), { problems: [], warnings: [] });
});

test("sandbox values only warn until production licensing is required", () => {
  const r = check(sandbox, {});
  assert.deepEqual(r.problems, []);
  assert.match(r.warnings.join("\n"), /Polar sandbox/);
});

test("sandbox values fail once production licensing is required", () => {
  const r = check(sandbox, REQUIRE);
  assert.match(r.problems.join("\n"), /Polar sandbox/);
  assert.deepEqual(r.warnings, []);
  assert.match(check({ ...prod, checkoutUrl: "https://sandbox-api.polar.sh/v1/x" }, REQUIRE).problems.join("\n"), /sandbox/);
});

test("a production release needs exactly the production API", () => {
  assert.match(check({ ...prod, apiBase: "https://example.com" }, REQUIRE).problems.join("\n"), /must be https:\/\/api\.polar\.sh/);
  assert.deepEqual(check({ ...prod, apiBase: "https://api.polar.sh/" }, REQUIRE).problems, []);
  assert.deepEqual(check({ ...prod, apiBase: "https://example.com" }, {}).problems, [], "not enforced before launch");
});

test("the original checks still fail in every mode", () => {
  for (const env of [{}, REQUIRE]) {
    const bad = check({ ...prod, licenseRequired: false, productId: " ", checkoutUrl: "http://x", trialDays: 0 }, env).problems;
    assert.equal(bad.length >= 4, true);
  }
});
