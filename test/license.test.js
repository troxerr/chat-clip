const test = require("node:test");
const assert = require("node:assert/strict");
const { licenseRequest, normalize, parseArgs } = require("../tools/license.js");

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
    product_name: "Chatclip",
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

test("license data is stored in the Keychain with a 14-day grace window", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "..", "mac", "license", "HDLicenseManager.m"), "utf8");
  for (const account of ["license_key", "instance_id", "last_validated_timestamp"]) assert.match(source, new RegExp(account));
  assert.match(source, /14 \* 24 \* 60 \* 60/);
  assert.match(source, /kIOPlatformUUIDKey/);
});
