"use strict";
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolvePublicFile } = require("./static-path");
const { spawn } = require("node:child_process");

const root = __dirname;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "saber-security-"));
const staticRoot = path.join(temp, "public-root");
fs.mkdirSync(staticRoot);
assert.equal(resolvePublicFile(staticRoot, "/index.html"), path.join(staticRoot, "index.html"));
assert.equal(resolvePublicFile(staticRoot, "../public-root-sibling-secret.txt"), null);
assert.equal(resolvePublicFile(staticRoot, "/%2e%2e/public-root-sibling-secret.txt"), null);
assert.equal(resolvePublicFile(staticRoot, "/%00secret.txt"), null);
assert.equal(resolvePublicFile(staticRoot, "/%E0%A4%A"), null);
const outsideSecret = path.join(temp, "outside-secret.txt");
fs.writeFileSync(outsideSecret, "must not be served");
fs.symlinkSync(outsideSecret, path.join(staticRoot, "outside-link.txt"));
assert.equal(resolvePublicFile(staticRoot, "/outside-link.txt"), null, "symlinks must not expose files outside public root");
const storePath = path.join(temp, "store.json");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "store.example.json"), "utf8"));
fixture.config.providers.routerKey = "persisted-router-secret-test";
fixture.config.providers.anthropic = "persisted-anthropic-secret-test";
fs.writeFileSync(storePath, JSON.stringify(fixture));

const port = 32000 + Math.floor(Math.random() * 20000);
const env = {
  ...process.env,
  PORT: String(port),
  HOST: "127.0.0.1",
  SABER_STORE_PATH: storePath,
  SABER_ROUTER_KEY: "environment-router-secret-test",
};
const child = spawn(process.execPath, [path.join(root, "server.js")], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });

async function waitForServer(base) {
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error("server exited before health check: " + output);
    try {
      const response = await fetch(base + "/api/health");
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not become healthy: " + output);
}

(async () => {
  const base = "http://127.0.0.1:" + port;
  try {
    await waitForServer(base);
    const malformedPath = await fetch(base + "/%E0%A4%A");
    assert.equal(malformedPath.status, 404, "malformed percent-encoding must be rejected without crashing the server");
    const healthAfterMalformedPath = await fetch(base + "/api/health");
    assert.equal(healthAfterMalformedPath.status, 200, "static path rejection must not interrupt the local API");

    const configResponse = await fetch(base + "/api/config");
    assert.equal(configResponse.status, 200);
    const config = await configResponse.json();
    assert.equal(config.providers.routerKey, "");
    assert.equal(config.providers.anthropic, "");
    assert.equal(config.providers.routerKeyConfigured, true);
    assert.equal(JSON.stringify(config).includes("environment-router-secret-test"), false);
    assert.equal(JSON.stringify(config).includes("persisted-router-secret-test"), false);
    assert.equal(fs.readFileSync(storePath, "utf8").includes("persisted-router-secret-test"), false);
    assert.equal(fs.readFileSync(storePath, "utf8").includes("persisted-anthropic-secret-test"), false);

    const hostileStatus = await new Promise((resolve, reject) => {
      const request = http.request({ hostname: "127.0.0.1", port, path: "/api/config", headers: { Host: "attacker.example" } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      request.on("error", reject);
      request.end();
    });
    assert.equal(hostileStatus, 403, "DNS-rebinding-style Host headers must be rejected");

    config.providers.routerKey = "request-body-secret-test";
    const rejectedConfig = await fetch(base + "/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config),
    });
    assert.equal(rejectedConfig.status, 400, "provider credentials must not be persisted");
    assert.equal(fs.readFileSync(storePath, "utf8").includes("request-body-secret-test"), false);

    const rejectedTest = await fetch(base + "/api/providers/test-router", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "http://127.0.0.1:1/v1", key: "request-body-secret-test" }),
    });
    assert.equal(rejectedTest.status, 400, "credentials must not be accepted in request bodies");

    const remotePort = port === 65535 ? 65534 : port + 1;
    const remote = spawn(process.execPath, [path.join(root, "server.js")], {
      cwd: root,
      env: { ...env, PORT: String(remotePort), HOST: "0.0.0.0", SABER_STORE_PATH: path.join(temp, "remote-store.json") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let remoteOutput = "";
    remote.stderr.on("data", (chunk) => { remoteOutput += chunk.toString(); });
    const remoteExit = await new Promise((resolve) => remote.on("exit", resolve));
    assert.notEqual(remoteExit, 0, "server must refuse non-loopback binds");
    assert.match(remoteOutput, /local-only/i);

    const rejectedCrossOrigin = await fetch(base + "/api/logs", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({ dir: "INTERNAL", source: "test", target: "test", type: "config", payload: "blocked" }),
    });
    assert.equal(rejectedCrossOrigin.status, 403, "cross-origin state changes must be rejected");

    const sameOriginMutation = await fetch(base + "/api/logs", {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ dir: "INTERNAL", source: "test", target: "test", type: "config", payload: "allowed" }),
    });
    assert.equal(sameOriginMutation.status, 201, "same-origin local requests must continue to work");

    const oversized = await fetch(base + "/api/logs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dir: "INTERNAL", source: "test", target: "test", type: "config", payload: "x".repeat(1_000_100) }),
    });
    assert.equal(oversized.status, 413, "oversized request bodies must return HTTP 413");

    const malformedJson = await fetch(base + "/api/logs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(malformedJson.status, 400, "malformed JSON must return HTTP 400");
    console.log("Security regression checks passed: env-only credentials, redaction, loopback binding, CSRF origin guard, and bounded request bodies.");
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
