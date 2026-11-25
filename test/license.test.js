const test = require("node:test");
const assert = require("node:assert/strict");
const { licenseRequest, normalize, parseArgs, detectProvider, parsePolarProduct } = require("../tools/license.js");

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

const ACTIVATE = {
  activated: true,
  license_key: { status: "active", activation_limit: 2, activation_usage: 1, expires_at: null },
  instance: { id: "instance-1", name: "Mac" },
  meta: {
    product_id: 123,
    product_name: "ClipSpike",
    customer_email: "creator@example.com"
  }
};

test("activate posts the key and instance name, then normalizes the response", async () => {
  let request = null;
  const result = await licenseRequest("activate", {
    licenseKey: "ABC-123",
    instanceName: "Mac",
    productId: "123",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response(ACTIVATE);
    }
  });
  assert.equal(request.url, "https://api.lemonsqueezy.com/v1/licenses/activate");
  assert.equal(request.options.body.get("license_key"), "ABC-123");
  assert.equal(request.options.body.get("instance_name"), "Mac");
  assert.equal(result.ok, true);
  assert.equal(result.valid, true);
  assert.equal(result.instanceId, "instance-1");
  assert.equal(result.customerEmail, "creator@example.com");
  assert.equal(result.productId, "123");
});

test("rejects a license for a different product", async () => {
  await assert.rejects(
    () => licenseRequest("activate", {
      licenseKey: "ABC-123",
      instanceName: "Mac",
      productId: "999",
      fetchImpl: async () => response(ACTIVATE)
    }),
    /different product/
  );
});

test("validate requires an instance and honors valid=false", async () => {
  await assert.rejects(
    () => licenseRequest("validate", { licenseKey: "ABC-123", fetchImpl: async () => response({ valid: false }) }),
    /instance ID/
  );
  await assert.rejects(
    () => licenseRequest("validate", {
      licenseKey: "ABC-123",
      instanceId: "instance-1",
      fetchImpl: async () => response({ valid: false, license_key: { status: "expired" } })
    }),
    /not valid/
  );
});

test("deactivate is not treated as an active license", async () => {
  const result = await licenseRequest("deactivate", {
    licenseKey: "ABC-123",
    instanceId: "instance-1",
    fetchImpl: async () => response({ deactivated: true, license_key: { status: "inactive" } })
  });
  assert.equal(result.ok, true);
  assert.equal(result.valid, false);
});

test("surfaces API errors without leaking the key", async () => {
  await assert.rejects(
    () => licenseRequest("activate", {
      licenseKey: "SECRET-KEY",
      instanceName: "Mac",
      fetchImpl: async () => response({ error: "License key not found." }, 404)
    }),
    (error) => {
      assert.match(error.message, /License key not found/);
      assert.equal(error.message.includes("SECRET-KEY"), false);
      return true;
    }
  );
});

test("normalizes missing metadata safely", () => {
  const result = normalize({ activated: true, license_key: { status: "active" } }, "activate");
  assert.equal(result.ok, true);
  assert.equal(result.instanceId, "");
  assert.equal(result.productId, "");
});

test("parseArgs supports the helper command line", () => {
  assert.deepEqual(parseArgs(["--action", "activate", "--license-key", "ABC-123"]), {
    action: "activate",
    "license-key": "ABC-123"
  });
});

test("a license with no product metadata is rejected when a product is expected", async () => {
  const noMeta = { ...ACTIVATE, meta: {} };
  await assert.rejects(
    () => licenseRequest("activate", { licenseKey: "ABC-123", productId: "123", fetchImpl: async () => response(noMeta) }),
    /could not be matched/
  );
});

test("network failures and 5xx responses are marked transient", async () => {
  await assert.rejects(
    () => licenseRequest("validate", { licenseKey: "K", instanceId: "i", fetchImpl: async () => { throw new TypeError("fetch failed"); } }),
    (error) => error.transient === true
  );
  await assert.rejects(
    () => licenseRequest("validate", { licenseKey: "K", instanceId: "i", fetchImpl: async () => response({}, 503) }),
    (error) => error.transient === true
  );
});

test("an invalid key is not transient", async () => {
  await assert.rejects(
    () => licenseRequest("validate", { licenseKey: "K", instanceId: "i", fetchImpl: async () => response({ valid: false, error: "license_key not found" }, 404) }),
    (error) => !error.transient
  );
});

test("build.sh compiles the license manager and links IOKit", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const script = fs.readFileSync(path.join(__dirname, "..", "mac", "build.sh"), "utf8");
  assert.match(script, /license\/HDLicenseManager\.m/);
  assert.match(script, /license\/HDKeychain\.m/);
  assert.match(script, /-framework IOKit/);
});

test("an ended Mac trial blocks a new capture instead of watermarking", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "..", "mac", "main.m"), "utf8");
  const ui = fs.readFileSync(path.join(__dirname, "..", "mac", "ui", "HDUI.m"), "utf8");
  assert.match(source, /The trial has ended\. Enter a license key to keep capturing\./);
  assert.doesNotMatch(source, /Free plan:/);
  assert.match(source, /CLIPSPIKE_PLAN"\] = @"pro"/);
  const toggle = source.slice(source.indexOf("- (void)toggleCapture:"), source.indexOf("- (BOOL)validVodTime:"));
  const vod = source.slice(source.indexOf("- (void)findHighlights:"), source.indexOf("- (void)findHighlights:") + 2500);
  assert.match(toggle, /newCaptureBlockReason/);
  assert.match(vod, /newCaptureBlockReason/);
  assert.match(ui, /a new capture does not start until a license is activated/);
});

test("license data is stored in the Keychain with a 14-day grace window", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "..", "mac", "license", "HDLicenseManager.m"), "utf8");
  for (const account of ["license_key", "instance_id", "last_validated_timestamp"]) assert.match(source, new RegExp(account));
  assert.match(source, /14 \* 24 \* 60 \* 60/);
  assert.match(source, /kIOPlatformUUIDKey/);
});

// ---- Polar provider -------------------------------------------------------
const ORG = "11111111-1111-4111-8111-111111111111";
const BENEFIT = "22222222-2222-4222-8222-222222222222";
const POLAR_KEY = { benefit_id: BENEFIT, status: "granted", limit_activations: 2, usage: 1, expires_at: null, customer: { email: "creator@example.com" } };

test("provider is detected from the API host or an explicit name", () => {
  assert.equal(detectProvider("https://api.polar.sh"), "polar");
  assert.equal(detectProvider("https://sandbox-api.polar.sh/"), "polar");
  assert.equal(detectProvider("https://api.lemonsqueezy.com"), "lemon");
  assert.equal(detectProvider("", ""), "lemon");
  assert.equal(detectProvider("https://proxy.example.com", "polar"), "polar");
  assert.deepEqual(parsePolarProduct(`${ORG}:${BENEFIT}`), { orgId: ORG, benefitId: BENEFIT });
  assert.deepEqual(parsePolarProduct(ORG), { orgId: ORG, benefitId: "" });
});

test("polar activate posts JSON and normalizes to the shape the app reads", async () => {
  let request = null;
  const result = await licenseRequest("activate", {
    licenseKey: "KEY-1", instanceName: "Mac", productId: `${ORG}:${BENEFIT}`, apiBase: "https://sandbox-api.polar.sh",
    fetchImpl: async (url, options) => { request = { url, options }; return response({ id: "act-1", license_key: POLAR_KEY }); }
  });
  assert.equal(request.url, "https://sandbox-api.polar.sh/v1/customer-portal/license-keys/activate");
  assert.equal(request.options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(request.options.body), { key: "KEY-1", organization_id: ORG, label: "Mac" });
  assert.equal(result.ok, true);
  assert.equal(result.valid, true);
  assert.equal(result.status, "active");
  assert.equal(result.instanceId, "act-1");
  assert.equal(result.productId, BENEFIT);
  assert.equal(result.customerEmail, "creator@example.com");
  assert.equal(result.activationLimit, 2);
  assert.equal(result.activationUsage, null);
});

test("polar validate sends the activation id and keeps it in the result", async () => {
  let body = null;
  const result = await licenseRequest("validate", {
    licenseKey: "KEY-1", instanceId: "act-1", productId: ORG, apiBase: "https://api.polar.sh",
    fetchImpl: async (url, options) => { body = JSON.parse(options.body); return response({ ...POLAR_KEY, activation: { id: "act-1" } }); }
  });
  assert.deepEqual(body, { key: "KEY-1", organization_id: ORG, activation_id: "act-1" });
  assert.equal(result.valid, true);
  assert.equal(result.instanceId, "act-1");
  await assert.rejects(() => licenseRequest("validate", { licenseKey: "KEY-1", productId: ORG, apiBase: "https://api.polar.sh", fetchImpl: async () => response({}) }), /instance ID is required/);
});

test("polar deactivate accepts an empty 204 response", async () => {
  const result = await licenseRequest("deactivate", {
    licenseKey: "KEY-1", instanceId: "act-1", productId: ORG, apiBase: "https://api.polar.sh",
    fetchImpl: async () => ({ ok: true, status: 204, async json() { throw new Error("no body"); } })
  });
  assert.equal(result.ok, true);
  assert.equal(result.valid, false);
  assert.equal(result.instanceId, "act-1");
});

test("polar rejects a key from a different benefit and a missing organization", async () => {
  await assert.rejects(() => licenseRequest("activate", {
    licenseKey: "KEY-1", productId: `${ORG}:${BENEFIT}`, apiBase: "https://api.polar.sh",
    fetchImpl: async () => response({ id: "act-1", license_key: { ...POLAR_KEY, benefit_id: "33333333-3333-4333-8333-333333333333" } })
  }), /different product/);
  await assert.rejects(() => licenseRequest("activate", { licenseKey: "KEY-1", productId: "", apiBase: "https://api.polar.sh", fetchImpl: async () => response({}) }), /organization ID/);
});

test("polar errors: 404 and 403 are final, 429 and 5xx are transient, the key never leaks", async () => {
  const call = (status, body) => licenseRequest("validate", { licenseKey: "SECRET-KEY", instanceId: "act-1", productId: ORG, apiBase: "https://api.polar.sh", fetchImpl: async () => response(body, status) });
  await assert.rejects(() => call(404, { error: "ResourceNotFound", detail: "License key does not exist." }), (e) => !e.transient && /not valid/.test(e.message) && !/SECRET-KEY/.test(e.message));
  await assert.rejects(() => call(403, { error: "NotPermitted", detail: "License key activation limit reached." }), (e) => !e.transient && /activation limit/.test(e.message));
  await assert.rejects(() => call(429, {}), (e) => e.transient === true);
  await assert.rejects(() => call(503, {}), (e) => e.transient === true);
  await assert.rejects(() => call(422, { detail: [{ msg: "bad" }] }), (e) => !e.transient && /failed \(422\)/.test(e.message));
  await assert.rejects(() => licenseRequest("validate", { licenseKey: "k", instanceId: "a", productId: ORG, apiBase: "https://api.polar.sh", fetchImpl: async () => { throw new Error("offline"); } }), (e) => e.transient === true);
});

test("polar releases the activation it just created when the key belongs to another benefit", async () => {
  const calls = [];
  await assert.rejects(() => licenseRequest("activate", {
    licenseKey: "KEY-1", productId: `${ORG}:${BENEFIT}`, apiBase: "https://api.polar.sh",
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return url.endsWith("/activate")
        ? response({ id: "act-9", license_key: { ...POLAR_KEY, benefit_id: "33333333-3333-4333-8333-333333333333" } })
        : { ok: true, status: 204, async json() { throw new Error("no body"); } };
    }
  }), /different product/);
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /\/deactivate$/);
  assert.equal(calls[1].body.activation_id, "act-9");
  assert.equal(calls[1].body.organization_id, ORG);
});
