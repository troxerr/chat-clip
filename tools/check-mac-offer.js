"use strict";

// A Mac release must sell the same production Polar license as Windows.
// win/build-config.json is the offer. A Lemon Squeezy host, a sandbox URL,
// or a different product id fails the check.

const PRODUCTION_API = "https://api.polar.sh";

function checkMacOffer(built = {}, offer = {}) {
  const problems = [];
  const checkout = String(offer.checkoutUrl || "");
  const product = String(offer.productId || "");
  const api = String(offer.apiBase || "").replace(/\/+$/, "");
  const price = String(offer.priceLabel || "").trim();
  const builtCheckout = String(built.checkoutUrl || "");
  const builtProduct = String(built.productId || "");
  const builtApi = String(built.apiBase || "").replace(/\/+$/, "");
  const builtPrice = String(built.priceLabel || "").trim();

  if (!(checkout.startsWith("https://buy.polar.sh/") && !/sandbox/i.test(checkout) && builtCheckout === checkout)) {
    problems.push("HDCheckoutURL must match the production Polar checkout in win/build-config.json");
  }
  if (!(product.includes(":") && !/sandbox/i.test(product) && builtProduct === product)) {
    problems.push("HDProductId must be the organization:benefit id in win/build-config.json");
  }
  if (!(api === PRODUCTION_API && builtApi === api)) {
    problems.push("HDLicenseApiBase must be https://api.polar.sh");
  }
  if (!(price && builtPrice === price)) {
    problems.push("HDPriceLabel must match priceLabel in win/build-config.json");
  }
  return problems;
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

if (require.main === module) {
  const problems = checkMacOffer(
    { checkoutUrl: arg("--checkout"), productId: arg("--product"), apiBase: arg("--api"), priceLabel: arg("--price") },
    require("../win/build-config.json")
  );
  for (const problem of problems) console.error(problem);
  if (problems.length) process.exit(1);
  console.log("Mac license offer matches the Windows Polar product.");
}

module.exports = { checkMacOffer, PRODUCTION_API };
