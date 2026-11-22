"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { Events } = require("discord.js");

test("follower command uses the explicit blog, configured default, or fallback", async () => {
  const handlers = {};
  const calls = [];
  const messages = [];
  class Client {
    on(event, handler) { handlers[event] = handler; }
    login() {}
  }
  const middleware = [];
  const routes = {};
  const app = {
    use(...args) { middleware.push(args); },
    get(route, handler) { routes[route] = handler; },
    listen(port, host, callback) { assert.equal(port, 4321); assert.equal(host, "127.0.0.1"); callback(); },
  };
  const express = () => app;
  express.static = () => () => {};
  const env = { BLOG_NAME: " configured-blog " };
  const getReblog = () => {};
  const getCachedReblogs = () => {};
  const verifyCachedPost = () => {};
  const dependencies = {
    dotenv: { config() {} },
    "./followers/tumblrcracker": { main: async (blog) => { calls.push(blog); return { success: true, data: "[]", filePath: "saved-snapshot.json" }; } },
    "discord.js": { Client, Events, GatewayIntentBits: {} },
    express,
    crypto: {},
    axios: {},
    path,
    "./threads/threadRoutes": { createThreadRoutes: (options) => {
      assert.equal(options.getReblog, getReblog);
      assert.equal(options.getCachedReblogs, getCachedReblogs);
      assert.equal(options.verifyCachedPost, verifyCachedPost);
      return () => {};
    } },
    "./threads/reblogCache": { createReblogCache: () => ({ get: getReblog, snapshot: getCachedReblogs, verify: verifyCachedPost }) },
    "./config/blogConfig": { getDefaultBlog: () => (env.BLOG_NAME || "").trim() || "iobartach" },
    "./config/migrateData": { migrateData() {} },
    "./config/tumblrAuth": { createTumblrAuth: (options) => {
      assert.equal(options.redirectUri, "http://localhost:4321/callback");
      return { router: () => {}, getToken: () => null };
    } },
    "./config/webConfig": { getWebConfig: () => ({ host: "127.0.0.1", port: 4321, origin: "http://localhost:4321", redirectUri: "http://localhost:4321/callback", allowedHosts: ["localhost:4321", "127.0.0.1:4321"] }) },
    "./discord/slashCommands": { SlashCommands: class { constructor(options) { assert.equal(options.getReblog, getReblog); } async handle() {} } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "src", "index.js"), "utf8"), {
    require: (name) => {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    process: { env },
    console: { log() {}, error() {} },
    __dirname: path.join(__dirname, "..", "src"),
  });
  assert.equal(handlers.ready, undefined);
  let allowed = false;
  middleware[0][0]({ get: () => "localhost:4321" }, {}, () => { allowed = true; });
  assert.equal(allowed, true);
  let denied = false;
  middleware[0][0]({ get: () => "evil.example:4321" }, { status: (status) => {
    assert.equal(status, 400);
    return { send: () => { denied = true; } };
  } }, () => {});
  assert.equal(denied, true);
  let redirected;
  routes["/authorize"]({ get: () => "127.0.0.1:4321" }, { redirect: (url) => { redirected = url; } }, () => {});
  assert.equal(redirected, "http://localhost:4321/authorize");
  assert.equal(Events.ClientReady, "clientReady");
  handlers[Events.ClientReady]();
  const send = async (content) => handlers.messageCreate({ content, channel: { send(value) { messages.push(value); } } });

  await send("$tumblrcracker");
  await send("$tumblrcracker   explicit-blog");
  env.BLOG_NAME = "  ";
  await send("$tumblrcracker ");
  delete env.BLOG_NAME;
  await send("$tumblrcracker");
  assert.deepEqual(calls, ["configured-blog", "explicit-blog", "iobartach", "iobartach"]);
  assert.equal(messages.filter((value) => value.files && value.files[0] === "saved-snapshot.json").length, 4);
});
