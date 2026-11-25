const test = require("node:test");
const assert = require("node:assert/strict");
const { checkMacOffer } = require("../tools/check-mac-offer.js");
const shipped = require("../win/build-config.json");

const offer = {
  checkoutUrl: "https://buy.polar.sh/polar_cl_example",
  productId: "org:benefit",
  apiBase: "https://api.polar.sh"
};

test("the shipped Windows offer is a valid Mac release target", () => {
  assert.deepEqual(checkMacOffer({
    checkoutUrl: shipped.checkoutUrl,
    productId: shipped.productId,
    apiBase: shipped.apiBase
  }, shipped), []);
});

test("a Mac build passes only when it matches the production Polar offer", () => {
  assert.deepEqual(checkMacOffer({
    checkoutUrl: offer.checkoutUrl,
    productId: offer.productId,
    apiBase: offer.apiBase
  }, offer), []);
  assert.deepEqual(checkMacOffer({
    checkoutUrl: offer.checkoutUrl,
    productId: offer.productId,
    apiBase: "https://api.polar.sh/"
  }, offer), []);
});

test("Lemon, sandbox, and a different product fail", () => {
  const lemon = checkMacOffer({
    checkoutUrl: "https://store.lemonsqueezy.com/buy/1",
    productId: "12345",
    apiBase: ""
  }, offer);
  assert.match(lemon.join("\n"), /HDCheckoutURL/);
  assert.match(lemon.join("\n"), /HDProductId/);
  assert.match(lemon.join("\n"), /HDLicenseApiBase/);

  const sandbox = checkMacOffer({
    checkoutUrl: "https://buy.polar.sh/sandbox",
    productId: offer.productId,
    apiBase: "https://sandbox-api.polar.sh"
  }, { ...offer, checkoutUrl: "https://buy.polar.sh/sandbox", apiBase: "https://sandbox-api.polar.sh" });
  assert.match(sandbox.join("\n"), /HDCheckoutURL/);
  assert.match(sandbox.join("\n"), /HDLicenseApiBase/);
});
