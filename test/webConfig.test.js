"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getWebConfig } = require("../src/config/webConfig");

test("web server defaults to local-only and derives all URLs from the port", () => {
  assert.deepEqual(getWebConfig({}), {
    host: "127.0.0.1", port: 3000, origin: "http://localhost:3000",
    redirectUri: "http://localhost:3000/callback",
    allowedHosts: ["localhost:3000", "127.0.0.1:3000"],
  });
  assert.deepEqual(getWebConfig({ PORT: " 4321 ", HOST: "0.0.0.0" }), {
    host: "127.0.0.1", port: 4321, origin: "http://localhost:4321",
    redirectUri: "http://localhost:4321/callback",
    allowedHosts: ["localhost:4321", "127.0.0.1:4321"],
  });
  assert.ok(getWebConfig({ PORT: "80" }).allowedHosts.includes("localhost"));
  assert.ok(getWebConfig({ PORT: "80" }).allowedHosts.includes("127.0.0.1"));
});

test("invalid port values fail explicitly", () => {
  for (const port of ["", "0", "65536", "1.5", "3000foo", "-1"]) {
    assert.throws(() => getWebConfig({ PORT: port }), /PORT must be/);
  }
});
