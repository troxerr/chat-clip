#!/usr/bin/env node
"use strict";

const { getSecret } = require("../lib/credentials.js");

const DEFAULT_API_BASE = "https://api.lemonsqueezy.com";
const POLAR_API_BASE = "https://api.polar.sh";
const POLAR_SANDBOX_API_BASE = "https://sandbox-api.polar.sh";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "";
    args[key] = value;
  }
  return args;
}

function normalize(data, action, expectedProductId = "") {
  const license = data.license_key || {};
  const meta = data.meta || {};
  const instance = data.instance || {};
  const status = String(license.status || "");
  const productId = meta.product_id === undefined || meta.product_id === null ? "" : String(meta.product_id);
  if (expectedProductId && productId !== String(expectedProductId)) {
    throw new Error(productId
      ? `This license belongs to a different product (${productId}).`
      : "This license could not be matched to ClipSpike.");
  }
  const ok = action === "activate"
    ? Boolean(data.activated)
    : action === "validate"
      ? Boolean(data.valid)
      : Boolean(data.deactivated);
  const valid = action !== "deactivate" && ok && status === "active";
  return {
    ok,
    valid: Boolean(valid),
    action,
    status,
    instanceId: instance.id || "",
    productId,
    productName: meta.product_name || "",
    customerEmail: meta.customer_email || "",
    expiresAt: license.expires_at || null,
    activationLimit: license.activation_limit || null,
    activationUsage: license.activation_usage || null
  };
}

function rejection(message, status = "") {
  const error = new Error(message);
  if (status === "expired" || /^(?:this |the )?license(?: key)? (?:has )?expired[.!]?$/i.test(message)) {
    error.licenseCode = "expired";
  } else if (/activation limit (?:reached|exceeded)|maximum number of activations/i.test(message)) {
    error.licenseCode = "activation-limit";
  } else {
    error.licenseCode = "rejected";
  }
  return error;
}

function transientError(message) {
  const error = new Error(message);
  error.transient = true;
  return error;
}

async function lemonRequest(action, {
  licenseKey,
  instanceName = "",
  instanceId = "",
  productId = "",
  apiBase = DEFAULT_API_BASE,
  fetchImpl = fetch
}) {
  if (!licenseKey) throw new Error("A license key is required.");
  const paths = {
    activate: "/v1/licenses/activate",
    validate: "/v1/licenses/validate",
    deactivate: "/v1/licenses/deactivate"
  };
  if (!paths[action]) throw new Error(`Unknown license action: ${action}`);
  const body = new URLSearchParams({ license_key: licenseKey });
  if (action === "activate") body.set("instance_name", instanceName || "ClipSpike");
  if (action === "validate" || action === "deactivate") {
    if (!instanceId) throw new Error("An instance ID is required.");
    body.set("instance_id", instanceId);
  }
  let response;
  try {
    response = await fetchImpl(`${String(apiBase).replace(/\/$/, "")}${paths[action]}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body,
      signal: AbortSignal.timeout(30000)
    });
  } catch (cause) {
    // Offline, DNS failure or timeout: says nothing about whether the key is valid.
    throw transientError("Could not reach the license service. Check your connection.");
  }
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    if (response.status >= 500 || response.status === 429) {
      throw transientError(data.error || data.message || `License service unavailable (${response.status}).`);
    }
    throw rejection(data.error || data.message || `License service failed (${response.status}).`);
  }
  if (data.error) throw new Error(String(data.error));
  if (action === "activate" && !data.activated) throw new Error("The license key could not be activated.");
  if (action === "validate" && !data.valid) throw new Error("The license is not valid.");
  if (action === "deactivate" && !data.deactivated) throw new Error("The activation could not be removed.");
  return normalize(data, action, productId);
}

// ---------------------------------------------------------------------------
// Polar (https://docs.polar.sh/docs/benefits/license-keys). The customer-portal
// endpoints need no secret and are meant for desktop apps. The app passes one
// "product ID" setting, so for Polar it is ORGANIZATION_ID or
// ORGANIZATION_ID:BENEFIT_ID (the license-key benefit, to reject keys from other
// products). The result is normalised to the same shape the app already reads.
function detectProvider(apiBase = "", provider = "") {
  const named = String(provider || "").trim().toLowerCase();
  if (named === "polar" || named === "lemon") return named;
  return /(^|\.)polar\.sh(\/|:|$)/i.test(String(apiBase).replace(/^https?:\/\//i, "")) ? "polar" : "lemon";
}

function parsePolarProduct(productId = "") {
  const [orgId = "", benefitId = ""] = String(productId).split(":").map((part) => part.trim());
  return { orgId, benefitId };
}

function polarErrorMessage(data, fallback) {
  const detail = data && (data.detail || data.message || data.error);
  return typeof detail === "string" && detail ? detail : fallback;
}

function normalizePolar(data, action, { benefitId = "", instanceId = "" } = {}) {
  data = data || {};
  const license = action === "activate" ? (data.license_key || {}) : data;
  const productId = license.benefit_id ? String(license.benefit_id) : "";
  if (action !== "deactivate" && benefitId && productId !== benefitId) {
    throw new Error(productId
      ? `This license belongs to a different product (${productId}).`
      : "This license could not be matched to ClipSpike.");
  }
  const status = action === "deactivate" ? "" : (license.status === "granted" ? "active" : String(license.status || ""));
  const activation = action === "activate" ? data : (data.activation || {});
  const valid = action !== "deactivate" && status === "active";
  return {
    ok: action === "deactivate" ? true : valid,
    valid,
    action,
    status,
    instanceId: (activation && activation.id) || instanceId || "",
    productId,
    productName: "",
    customerEmail: (license.customer && license.customer.email) || "",
    expiresAt: license.expires_at || null,
    activationLimit: license.limit_activations || null,
    activationUsage: null // Polar's `usage` is a usage-quota counter, not the number of activations
  };
}

async function polarRequest(action, {
  licenseKey,
  instanceName = "",
  instanceId = "",
  productId = "",
  apiBase = POLAR_API_BASE,
  fetchImpl = fetch
}) {
  if (!licenseKey) throw new Error("A license key is required.");
  const paths = {
    activate: "/v1/customer-portal/license-keys/activate",
    validate: "/v1/customer-portal/license-keys/validate",
    deactivate: "/v1/customer-portal/license-keys/deactivate"
  };
  if (!paths[action]) throw new Error(`Unknown license action: ${action}`);
  const { orgId, benefitId } = parsePolarProduct(productId);
  if (!orgId) throw new Error("Polar licensing needs an organization ID: set the product ID to ORG_ID or ORG_ID:BENEFIT_ID.");
  const body = { key: licenseKey, organization_id: orgId };
  if (action === "activate") body.label = instanceName || "ClipSpike";
  if (action === "validate" || action === "deactivate") {
    if (!instanceId) throw new Error("An instance ID is required.");
    body.activation_id = instanceId;
  }
  let response;
  try {
    response = await fetchImpl(`${String(apiBase || POLAR_API_BASE).replace(/\/$/, "")}${paths[action]}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });
  } catch (cause) {
    throw transientError("Could not reach the license service. Check your connection.");
  }
  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    if (response.status >= 500 || response.status === 429) {
      throw transientError(polarErrorMessage(data, `License service unavailable (${response.status}).`));
    }
    if (response.status === 404) {
      throw rejection(action === "deactivate" ? "The activation could not be found." : "The license key is not valid, or has been revoked or expired.");
    }
    if (response.status === 403) {
      throw rejection(polarErrorMessage(data, "The license service rejected this request. Check your key and available activations."));
    }
    throw new Error(polarErrorMessage(data, `License service failed (${response.status}).`));
  }
  try {
    const result = normalizePolar(data, action, { benefitId, instanceId });
    if (action === "activate" && !result.valid) {
      throw rejection(result.status === "expired" ? "This license has expired." : "This license is not active.", result.status);
    }
    return result;
  } catch (error) {
    // Polar has already created the activation by now. A key from another product must not
    // keep one of the buyer's activation slots, so release it (best effort) before failing.
    if (action === "activate" && data && data.id) {
      try {
        await polarRequest("deactivate", { licenseKey, instanceId: data.id, productId, apiBase, fetchImpl });
      } catch {}
    }
    throw error;
  }
}

async function licenseRequest(action, options = {}) {
  const provider = detectProvider(options.apiBase, options.provider);
  if (provider === "polar") return polarRequest(action, options);
  return lemonRequest(action, options);
}

// Order: --license-key, LEMON_LICENSE_KEY, then the credential store
// (Windows DPAPI). The store is only read when the first two are empty.
function resolveLicenseKey(args = {}, env = process.env, secret = getSecret) {
  return String(args["license-key"] || env.LEMON_LICENSE_KEY || secret("license.key") || "").trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const action = String(args.action || "validate").trim();
  const licenseKey = resolveLicenseKey(args);
  const instanceName = String(args["instance-name"] || process.env.LEMON_INSTANCE_NAME || "ClipSpike").trim();
  const instanceId = String(args["instance-id"] || process.env.LEMON_INSTANCE_ID || "").trim();
  const productId = String(args["product-id"] || process.env.LEMON_PRODUCT_ID || "").trim();
  const provider = String(args.provider || process.env.LICENSE_PROVIDER || "").trim();
  const apiBase = String(args["api-base"] || process.env.LEMON_API_BASE || "").trim()
    || (detectProvider("", provider) === "polar" ? POLAR_API_BASE : DEFAULT_API_BASE);
  const result = await licenseRequest(action, { licenseKey, instanceName, instanceId, productId, apiBase, provider });
  process.stdout.write(JSON.stringify(result) + "\n");
}

if (require.main === module) {
  main().catch((error) => {
    process.stdout.write(JSON.stringify({ ok: false, error: error.message, code: error.transient ? "temporarily-unavailable" : error.licenseCode || "rejected", transient: Boolean(error.transient) }) + "\n");
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_API_BASE,
  POLAR_API_BASE,
  POLAR_SANDBOX_API_BASE,
  detectProvider,
  parsePolarProduct,
  normalizePolar,
  polarRequest,
  lemonRequest,
  parseArgs,
  normalize,
  licenseRequest,
  resolveLicenseKey
};
