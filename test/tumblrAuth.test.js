"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createTumblrAuth } = require("../src/config/tumblrAuth");

test("OAuth state is browser-bound, single-use, expires, and token stays server-side", async (t) => {
  let time = 0;
  let calls = 0;
  const auth = createTumblrAuth({
    clientId: "client", clientSecret: "secret", redirectUri: "http://localhost:3000/callback",
    now: () => time,
    api: { post: async () => { calls++; return { data: { access_token: "private-token" } }; } },
  });
  const app = express();
  app.use(auth.router);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const start = async () => {
    const response = await fetch(`${base}/authorize`, { redirect: "manual" });
    const state = new URL(response.headers.get("location")).searchParams.get("state");
    const cookie = response.headers.get("set-cookie").split(";")[0];
    return { state, cookie };
  };
  let flow = await start();
  let result = await fetch(`${base}/callback?state=${flow.state}&code=abc`);
  assert.equal(result.status, 400);
  assert.equal(calls, 0);
  flow = await start();
  result = await fetch(`${base}/callback?state=${flow.state}&code=abc`, { headers: { Cookie: flow.cookie } });
  assert.equal(result.status, 200);
  assert.doesNotMatch(await result.text(), /private-token/);
  assert.equal(auth.getToken(), "private-token");
  assert.equal((await fetch(`${base}/callback?state=${flow.state}&code=abc`, { headers: { Cookie: flow.cookie } })).status, 400);
  flow = await start();
  time += 600001;
  assert.equal((await fetch(`${base}/callback?state=${flow.state}&code=abc`, { headers: { Cookie: flow.cookie } })).status, 400);
  assert.equal(calls, 1);
});
