#!/usr/bin/env node
"use strict";

const { getSecret } = require("../lib/credentials.js");

const DEFAULT_API_BASE = "https://api.lemonsqueezy.com";

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
      : "This license could not be matched to Chatclip.");
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

function transientError(message) {
  const error = new Error(message);
  error.transient = true;
  return error;
}

async function licenseRequest(action, {
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
  if (action === "activate") body.set("instance_name", instanceName || "Chatclip");
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
    throw new Error(data.error || data.message || `License service failed (${response.status}).`);
  }
  if (data.error) throw new Error(String(data.error));
  if (action === "activate" && !data.activated) throw new Error("The license key could not be activated.");
  if (action === "validate" && !data.valid) throw new Error("The license is not valid.");
  if (action === "deactivate" && !data.deactivated) throw new Error("The activation could not be removed.");
  return normalize(data, action, productId);
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
  const instanceName = String(args["instance-name"] || process.env.LEMON_INSTANCE_NAME || "Chatclip").trim();
  const instanceId = String(args["instance-id"] || process.env.LEMON_INSTANCE_ID || "").trim();
  const productId = String(args["product-id"] || process.env.LEMON_PRODUCT_ID || "").trim();
  const apiBase = String(args["api-base"] || process.env.LEMON_API_BASE || DEFAULT_API_BASE).trim();
  const result = await licenseRequest(action, { licenseKey, instanceName, instanceId, productId, apiBase });
  process.stdout.write(JSON.stringify(result) + "\n");
}

if (require.main === module) {
  main().catch((error) => {
    process.stdout.write(JSON.stringify({ ok: false, error: error.message, transient: Boolean(error.transient) }) + "\n");
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_API_BASE,
  parseArgs,
  normalize,
  licenseRequest,
  resolveLicenseKey
};
