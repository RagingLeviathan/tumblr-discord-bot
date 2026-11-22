"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const { createReblogCache } = require("../src/threads/reblogCache");
const { createThreadRoutes } = require("../src/threads/threadRoutes");
const { createThreadStore } = require("../src/threads/threadTracker");
const { SlashCommands } = require("../src/discord/slashCommands");

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reblog-cache-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "reblog-cache.json");
  let time = 1700000000000;
  const options = { file, now: () => time, sleep: async (ms) => { time += ms; } };
  return { file, options, advance: (ms) => { time += ms; }, time: () => time };
}

function thread(postId) {
  return { blog: "root", postId, url: `https://www.tumblr.com/root/${postId}` };
}

test("persists one-hour results, deduplicates requests, and spaces Tumblr calls", async (t) => {
  const f = setup(t);
  const calls = [];
  const api = { get: async (_url, options) => {
    calls.push({ time: f.time(), postId: options.params.id });
    return { data: { response: { notes: [{ type: "reblog", blog_name: "poster", timestamp: 1700000000 }] } } };
  } };
  const cache = createReblogCache(f.options);
  const [first, duplicate, other] = await Promise.all([
    cache.get(thread("1"), "key", api), cache.get(thread("1"), "key", api), cache.get(thread("2"), "key", api),
  ]);
  assert.equal(first.lastReblog.blog, "poster");
  assert.deepEqual(first, duplicate);
  assert.equal(other.lastReblog.blog, "poster");
  assert.deepEqual(calls.map((call) => call.postId), ["1", "2"]);
  assert.ok(calls[1].time - calls[0].time >= 1000);
  assert.equal(JSON.parse(fs.readFileSync(f.file, "utf8")).entries.length, 2);
  const restored = createReblogCache(f.options);
  assert.equal((await restored.get(thread("1"), "key", api)).cache.checkedAt, first.cache.checkedAt);
  assert.equal(calls.length, 2);
  f.advance(60 * 60 * 1000);
  await restored.get(thread("1"), "key", api);
  assert.equal(calls.length, 3);
});

test("persists a reblogger's UUID without invalidating older cache entries", async (t) => {
  const f = setup(t);
  const api = { get: async () => ({ data: { response: { notes: [
    { type: "reblog", blog_name: "poster", blog_uuid: "t:Test_UUID", timestamp: 1700000000 },
  ] } } }) };
  const cache = createReblogCache(f.options);
  assert.equal((await cache.get(thread("1"), "key", api)).lastReblog.blogUuid, "t:Test_UUID");
  assert.equal(createReblogCache(f.options).snapshot([thread("1")])[0].lastReblog.blogUuid, "t:Test_UUID");
  const saved = JSON.parse(fs.readFileSync(f.file, "utf8"));
  delete saved.entries[0].result.lastReblog.blogUuid;
  fs.writeFileSync(f.file, JSON.stringify(saved));
  assert.equal(createReblogCache(f.options).snapshot([thread("1")])[0].lastReblog.blog, "poster");
});

test("verifies and persists blog identities, resolves renames, and respects cooldown", async (t) => {
  const f = setup(t);
  const file = path.join(path.dirname(f.file), "threads.json");
  fs.writeFileSync(file, "[]");
  const store = createThreadStore(file);
  store.add("w/ partner | story", "https://www.tumblr.com/root/123", "au-1");
  store.setFlags("root", "123", { completed: true, favourite: true });
  const calls = [];
  let rename = false;
  let limited = false;
  const api = { get: async (url, options) => {
    calls.push({ url, time: f.time() });
    if (limited) throw Object.assign(new Error("limited"), { response: { status: 429 } });
    if (url.endsWith("/notes")) return { data: { response: { notes: [
      { type: "reblog", blog_name: "author", blog_uuid: "t:Author", timestamp: 100 },
    ] } } };
    const name = rename ? "renamed" : "root";
    return { data: { response: { blog: { name, uuid: "t:Root" }, posts: [
      { id_string: options.params.id, blog_name: name },
    ] } } };
  } };
  const cache = createReblogCache(f.options);
  const app = express();
  app.use("/api/threads", createThreadRoutes({ store, api, getBlog: () => "iobartach", getApiKey: () => "key",
    getReblog: cache.get, getCachedReblogs: cache.snapshot, verifyCachedPost: cache.verify }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/threads/root/123`;
  const identity = () => fetch(`${base}/identity`, { method: "POST", headers: { "X-Thread-Blog": "iobartach" } });
  assert.equal((await fetch(`${base}/identity`, { method: "POST" })).status, 400);
  let response = await identity();
  assert.equal(response.status, 200);
  let saved = await response.json();
  assert.equal(saved.blogUuid, "t:Root");
  assert.equal(saved.resolvedBlog, "root");
  assert.equal(saved.auId, "au-1");
  assert.equal(saved.completed, true);
  assert.equal(saved.favourite, true);
  assert.equal(saved.url, "https://www.tumblr.com/root/123");
  rename = true;
  response = await identity();
  assert.equal(response.status, 200);
  saved = await response.json();
  assert.equal(saved.resolvedBlog, "renamed");
  assert.match(calls[1].url, /t%3ARoot\/posts$/);
  const reblog = await (await fetch(`${base}/reblog?force=1`)).json();
  assert.equal(reblog.lastReblog.blogUuid, "t:Author");
  assert.match(calls[2].url, /t%3ARoot\/notes$/);
  assert.ok(calls[1].time - calls[0].time >= 1000);
  assert.ok(calls[2].time - calls[1].time >= 1000);
  store.update("root", "123", "w/ partner | edited", saved.url, "au-1", true);
  assert.equal(store.list()[0].blogUuid, "t:Root");
  assert.equal(store.list()[0].resolvedBlog, "renamed");
  limited = true;
  assert.equal((await identity()).status, 429);
  const before = calls.length;
  assert.equal((await identity()).status, 429);
  assert.equal(calls.length, before);
  assert.equal(store.list()[0].resolvedBlog, "renamed");
});

test("does not save an identity for an unverified post or a mismatched UUID", async (t) => {
  const f = setup(t);
  const file = path.join(path.dirname(f.file), "threads.json");
  fs.writeFileSync(file, "[]");
  const store = createThreadStore(file);
  store.add("Story", "https://www.tumblr.com/root/123");
  const cache = createReblogCache(f.options);
  let response = { blog: { name: "root", uuid: "t:Root" }, posts: [{ id_string: "999", blog_name: "root" }] };
  const api = { get: async () => ({ data: { response } }) };
  await assert.rejects(cache.verify(store.list()[0], "key", api), /unexpected/);
  assert.equal(store.list()[0].blogUuid, undefined);
  response = { blog: { name: "root" }, posts: [{ id_string: "123", blog_name: "root" }] };
  assert.equal((await cache.verify(store.list()[0], "key", api)).blogUuid, undefined);
  store.setBlogIdentity("root", "123", "t:Root", "root");
  response = { blog: { name: "renamed", uuid: "t:Different" }, posts: [{ id_string: "123", blog_name: "renamed" }] };
  await assert.rejects(cache.verify(store.list()[0], "key", api), /unexpected/);
  assert.equal(store.list()[0].resolvedBlog, "root");
  store.update("root", "123", "Story", "https://www.tumblr.com/other/456");
  assert.equal(store.list()[0].blogUuid, undefined);
});

test("reads only tracked cached results without Tumblr calls and supports explicit checks", async (t) => {
  const f = setup(t);
  let calls = 0;
  const api = { get: async () => {
    calls++;
    return { data: { response: { notes: [{ type: "reblog", blog_name: "poster", timestamp: 1700000000 }] } } };
  } };
  const cache = createReblogCache(f.options);
  await cache.get(thread("1"), "key", api);
  await cache.get(thread("2"), "key", api);
  const snapshot = cache.snapshot([thread("1"), thread("3")]);
  assert.equal(snapshot.length, 1);
  assert.equal(snapshot[0].postId, "1");
  assert.equal(snapshot[0].cache.stale, false);
  assert.equal(snapshot[0].cache.freshUntil, snapshot[0].cache.checkedAt + 60 * 60 * 1000);
  assert.equal(calls, 2);
  f.advance(60 * 60 * 1000);
  assert.equal(cache.snapshot([thread("1")])[0].cache.stale, true);
  assert.equal(calls, 2);
  await cache.get(thread("1"), "key", api);
  await cache.get(thread("1"), "key", api, { force: true });
  assert.equal(calls, 4);
  api.get = async () => {
    calls++;
    throw Object.assign(new Error("limited"), { response: { status: 429 } });
  };
  assert.match((await cache.get(thread("1"), "key", api, { force: true })).cache.warning, /rate limit/i);
  assert.equal((await cache.get(thread("1"), "key", api, { force: true })).cache.stale, true);
  assert.equal(calls, 5);
});

test("pauses after 429 and returns clearly marked stale data across restarts", async (t) => {
  const f = setup(t);
  let calls = 0;
  let limited = false;
  const api = { get: async () => {
    calls++;
    if (limited) {
      const error = new Error("rate limited");
      error.response = { status: 429, headers: { "retry-after": "120" } };
      throw error;
    }
    return { data: { response: { notes: [{ type: "reblog", blog_name: "poster", timestamp: 1700000000 }] } } };
  } };
  const cache = createReblogCache(f.options);
  const first = await cache.get(thread("1"), "key", api);
  f.advance(60 * 60 * 1000);
  limited = true;
  const stale = await cache.get(thread("1"), "key", api);
  assert.equal(stale.cache.checkedAt, first.cache.checkedAt);
  assert.equal(stale.cache.stale, true);
  assert.match(stale.cache.warning, /rate limit/i);
  const restored = createReblogCache(f.options);
  assert.equal((await restored.get(thread("1"), "key", api)).cache.stale, true);
  await assert.rejects(restored.get(thread("2"), "key", api), (error) => error.response.status === 429);
  assert.equal(calls, 2);
  f.advance(120 * 1000);
  limited = false;
  assert.equal((await restored.get(thread("1"), "key", api)).cache.stale, false);
  assert.equal(calls, 3);
});

test("backs off other errors and reports cache storage failures", async (t) => {
  const f = setup(t);
  let calls = 0;
  const api = { get: async () => { calls++; throw Object.assign(new Error("offline"), { code: "ECONNABORTED" }); } };
  const cache = createReblogCache(f.options);
  await assert.rejects(cache.get(thread("1"), "key", api), /offline/);
  await assert.rejects(cache.get(thread("1"), "key", api), /offline/);
  assert.equal(calls, 1);
  f.advance(60 * 1000);
  await assert.rejects(cache.get(thread("1"), "key", api), /offline/);
  assert.equal(calls, 2);
  fs.writeFileSync(f.file, "{");
  await assert.rejects(createReblogCache(f.options).get(thread("1"), "key", api), /reblog cache/i);
  assert.equal(calls, 2);
});

test("caches saved-post results and spaces both Tumblr requests", async (t) => {
  const f = setup(t);
  const times = [];
  const api = { get: async (url) => {
    times.push(f.time());
    return url.endsWith("/notes")
      ? { data: { response: { notes: [] } } }
      : { data: { response: { posts: [{ id_string: "1", blog_name: "root", timestamp: 1700000000 }] } } };
  } };
  const cache = createReblogCache(f.options);
  const result = await cache.get(thread("1"), "key", api);
  assert.equal(result.lastReblog, null);
  assert.equal(result.savedPost.blog, "root");
  assert.ok(times[1] - times[0] >= 1000);
  await createReblogCache(f.options).get(thread("1"), "key", api);
  assert.equal(times.length, 2);
});

test("web and Discord share cached results and report stale rate-limited data", async (t) => {
  const f = setup(t);
  const threadFile = path.join(path.dirname(f.file), "threads.json");
  fs.writeFileSync(threadFile, "[]");
  const store = createThreadStore(threadFile);
  store.add("Test thread", "https://www.tumblr.com/root/1");
  let calls = 0;
  const api = { get: async () => {
    calls++;
    if (calls > 1) throw Object.assign(new Error("limited"), { response: { status: 429 } });
    return { data: { response: { notes: [{ type: "reblog", blog_name: "poster", timestamp: 1700000000 }] } } };
  } };
  const cache = createReblogCache(f.options);
  const app = express();
  app.use("/api/threads", createThreadRoutes({ store, api, getApiKey: () => "key", getReblog: cache.get, getCachedReblogs: cache.snapshot }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/threads/root/1/reblog`;
  const web = await (await fetch(url)).json();
  assert.equal(web.lastReblog.blog, "poster");
  assert.equal(web.cache.stale, false);
  const cacheResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/threads/reblogs/cache`);
  assert.equal(cacheResponse.status, 200);
  assert.equal((await cacheResponse.json())[0].postId, "1");
  assert.equal(calls, 1);
  assert.equal((await fetch(`${url}?force=invalid`)).status, 400);
  const commands = new SlashCommands({ store, api, getApiKey: () => "key", getReblog: cache.get });
  const interaction = {
    commandName: "thread",
    options: { getSubcommand: () => "latest", getString: () => "https://www.tumblr.com/root/1" },
  };
  assert.match((await commands.execute(interaction)).content, /Last checked:/);
  assert.equal(calls, 1);
  const manual = await (await fetch(`${url}?force=1`)).json();
  assert.equal(manual.cache.stale, true);
  assert.match(manual.cache.warning, /rate limit/i);
  assert.equal(calls, 2);
  f.advance(60 * 60 * 1000);
  const stale = await (await fetch(url)).json();
  assert.equal(stale.cache.stale, true);
  assert.match(stale.cache.warning, /rate limit/i);
  assert.match((await commands.execute(interaction)).content, /rate limit/i);
  assert.equal(calls, 3);
});
