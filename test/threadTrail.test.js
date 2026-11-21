"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getTrail, postFromId } = require("../src/threads/threadTracker");
const { createThreadRoutes } = require("../src/threads/threadRoutes");
const express = require("express");

const thread = postFromId("iobartach", "778122704243097600");
const trail = [
  { blog: { name: "Root", uuid: "uuid" }, post: { id: "778122704243097601" } },
  { broken_blog_name: "deleted" },
  { blog: { uuid: "only-uuid" }, post: { id: 778122704243097600 } },
];

test("public trail uses NPF and preserves IDs without inventing broken links", async () => {
  const api = { get: async (url, options) => {
    assert.match(url, /\/posts$/);
    assert.deepEqual(options.params, { id: thread.postId, api_key: "key", npf: true, reblog_info: true });
    return { data: { response: { posts: [{ id_string: thread.postId, blog_name: thread.blog, trail }] } } };
  } };
  const result = await getTrail(thread, { api, apiKey: "key" });
  assert.equal(result.entries[0].url, "https://www.tumblr.com/root/778122704243097601");
  assert.equal(result.entries[1].brokenBlog, "deleted");
  assert.equal(result.entries[1].url, null);
  assert.equal(result.entries[2].postId, null);
  assert.equal(result.entries[2].blogUuid, "only-uuid");
});

test("authenticated trail sends bearer token only in headers and checks response", async () => {
  let called = false;
  const api = { get: async (url, options) => {
    called = true;
    assert.match(url, /posts\/778122704243097600$/);
    assert.equal(options.headers.Authorization, "Bearer private-token");
    assert.deepEqual(options.params, { post_format: "npf" });
    return { data: { response: { id: thread.postId, parent_post_id: "123", trail } } };
  } };
  await assert.rejects(getTrail(thread, { api, authenticated: true }), /Authorize Tumblr/);
  assert.equal(called, false);
  const result = await getTrail(thread, { api, authenticated: true, accessToken: "private-token" });
  assert.equal(result.parentPostId, "123");
  assert.equal(result.entries.length, 3);
  await assert.rejects(getTrail(thread, { api: { get: async () => ({ data: { response: { id: "12" } } }) }, accessToken: "token", authenticated: true }), /different post/);
});

test("empty, malformed and inaccessible trails are distinguished", async () => {
  const apiFor = (post) => ({ get: async () => ({ data: { response: { posts: [post] } } }) });
  const post = { id_string: thread.postId, blog_name: thread.blog };
  assert.deepEqual(await getTrail(thread, { api: apiFor(post), apiKey: "key" }), { entries: [], parentPostId: null });
  await assert.rejects(getTrail(thread, { api: apiFor({ ...post, trail: {} }), apiKey: "key" }), /invalid reblog trail/);
  await assert.rejects(getTrail(thread, { api: apiFor({ ...post, blog_name: "other" }), apiKey: "key" }), /unexpected post response/);
  await assert.rejects(getTrail(thread, { api: { get: async () => { throw new Error("offline"); } }, apiKey: "key" }), /offline/);
});

test("trail route requires current collection and protects authenticated token", async (t) => {
  const api = { get: async (url) => {
    if (url.endsWith("/posts")) return { data: { response: { posts: [{ id_string: thread.postId, blog_name: thread.blog, trail }] } } };
    const error = new Error("sensitive token"); error.response = { status: 403 }; throw error;
  } };
  const app = express();
  app.use("/api/threads", createThreadRoutes({
    store: { list: () => [thread] }, getBlog: () => "iobartach",
    getApiKey: () => "key", getAccessToken: () => "sensitive token", api,
  }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/threads/iobartach/${thread.postId}/trail`;
  assert.equal((await fetch(`${base}?mode=public`)).status, 400);
  assert.equal((await fetch(`${base}?mode=public`, { headers: { "X-Thread-Blog": "old" } })).status, 409);
  const headers = { "X-Thread-Blog": "iobartach" };
  const success = await fetch(`${base}?mode=public`, { headers });
  assert.equal(success.headers.get("cache-control"), "no-store");
  assert.equal((await success.json()).entries.length, 3);
  const failure = await fetch(`${base}?mode=authenticated`, { headers });
  assert.equal(failure.status, 502);
  assert.doesNotMatch(await failure.text(), /sensitive token/);
});
