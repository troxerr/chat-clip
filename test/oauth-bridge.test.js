const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  createPkce,
  buildAuthorizeUrl,
  redirectUri,
  serveCallback,
  exchangeToken,
  fetchProfile,
  parseArgs
} = require("../tools/oauth-bridge.js");

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return typeof body === "string" ? body : JSON.stringify(body); }
  };
}

test("PKCE verifier and challenge are URL-safe and distinct", () => {
  const { verifier, challenge } = createPkce();
  assert.match(verifier, /^[A-Za-z0-9_-]{43,}$/);
  assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(verifier, challenge);
});

test("Dropbox authorization URL requests offline PKCE access", () => {
  const url = new URL(buildAuthorizeUrl("dropbox", {
    clientId: "app-key",
    redirect: redirectUri("dropbox", 53682),
    state: "state",
    challenge: "challenge"
  }));
  assert.equal(url.origin + url.pathname, "https://www.dropbox.com/oauth2/authorize");
  assert.equal(url.searchParams.get("token_access_type"), "offline");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:53682/callback");
});

test("Google authorization URL requests offline Drive file access", () => {
  const url = new URL(buildAuthorizeUrl("google", {
    clientId: "client",
    redirect: redirectUri("google", 53683),
    state: "state",
    challenge: "challenge"
  }));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.match(url.searchParams.get("scope"), /drive\.file/);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:53683/oauth2callback");
});

test("Dropbox token exchange sends PKCE without a client secret", async () => {
  let request = null;
  const token = await exchangeToken("dropbox", {
    code: "code",
    clientId: "app-key",
    redirect: "http://127.0.0.1:53682/callback",
    verifier: "verifier",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({ refresh_token: "refresh", access_token: "access" });
    }
  });
  assert.equal(token.refresh_token, "refresh");
  assert.equal(request.url, "https://api.dropboxapi.com/oauth2/token");
  assert.equal(request.options.body.get("code_verifier"), "verifier");
  assert.equal(request.options.body.get("client_secret"), null);
});

test("Google token exchange includes the desktop client secret", async () => {
  let body = null;
  await exchangeToken("google", {
    code: "code",
    clientId: "client",
    clientSecret: "secret",
    redirect: "http://127.0.0.1:53683/oauth2callback",
    verifier: "verifier",
    fetchImpl: async (url, options) => {
      body = options.body;
      return response({ refresh_token: "refresh", access_token: "access" });
    }
  });
  assert.equal(body.get("client_secret"), "secret");
  assert.equal(body.get("code_verifier"), "verifier");
});

test("fails when the provider does not return a refresh token", async () => {
  await assert.rejects(
    () => exchangeToken("dropbox", {
      code: "code",
      clientId: "app-key",
      redirect: "http://127.0.0.1:53682/callback",
      verifier: "verifier",
      fetchImpl: async () => response({ access_token: "access" })
    }),
    /refresh_token|Token exchange failed/
  );
});

test("profile fetch parses Dropbox and Google identities", async () => {
  const dropbox = await fetchProfile("dropbox", {
    accessToken: "token",
    fetchImpl: async (url, options) => {
      assert.equal(options.method, "POST");
      return response({ email: "streamer@example.com", name: { display_name: "Streamer" } });
    }
  });
  assert.equal(dropbox.account, "streamer@example.com");
  assert.equal(dropbox.displayName, "Streamer");

  const google = await fetchProfile("google", {
    accessToken: "token",
    fetchImpl: async () => response({ email: "creator@example.com", name: "Creator" })
  });
  assert.equal(google.account, "creator@example.com");
  assert.equal(google.displayName, "Creator");
});

test("parseArgs supports values containing punctuation", () => {
  assert.deepEqual(parseArgs(["--provider", "google", "--client-id", "abc.apps.googleusercontent.com"]), {
    provider: "google",
    "client-id": "abc.apps.googleusercontent.com"
  });
});


test("loopback callback accepts a matching state and returns the code", async () => {
  const port = 54999;
  const result = serveCallback({ provider: "dropbox", port, state: "expected", timeoutMs: 5000 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const body = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/callback?code=abc&state=expected`, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks).toString()));
    }).on("error", reject);
  });
  assert.match(body, /Storage connected/);
  assert.deepEqual(await result, { code: "abc" });
});

test("loopback callback rejects a state mismatch", async () => {
  const port = 54998;
  const result = serveCallback({ provider: "google", port, state: "expected", timeoutMs: 5000 });
  const expectation = assert.rejects(result, /state did not match/);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/oauth2callback?code=abc&state=wrong`, (response) => {
      response.resume();
      response.on("end", resolve);
    }).on("error", reject);
  });
  await expectation;
});
