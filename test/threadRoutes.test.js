"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const { createThreadStore, createBlogThreadStore } = require("../src/threads/threadTracker");
const { createThreadRoutes } = require("../src/threads/threadRoutes");
const { createAuStore } = require("../src/threads/auStore");
const { createAskStore } = require("../src/threads/askStore");

test("saves and removes manual asks per blog without Tumblr requests", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-asks-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let blog = "first";
  const app = express();
  app.use("/api/threads", createThreadRoutes({
    getBlog: () => blog,
    store: createBlogThreadStore({ directory: dir, getBlog: () => blog }),
    auStore: (name) => createAuStore(name, dir),
    askStore: (name) => createAskStore(name, dir),
    api: { get: () => { throw new Error("Unexpected Tumblr request"); } },
  }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/threads/asks`;
  const send = (method, suffix = "", body, header = blog) => fetch(`${base}${suffix}`, {
    method, headers: { "Content-Type": "application/json", "X-Thread-Blog": header },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.deepEqual(await (await send("GET")).json(), []);
  const response = await send("POST", "", { url: "https://www.tumblr.com/Example/832760197646860288/title?source=share", note: "  An idea  " });
  assert.equal(response.status, 201);
  const ask = await response.json();
  assert.equal(ask.url, "https://www.tumblr.com/example/832760197646860288");
  assert.equal(ask.note, "An idea");
  assert.equal((await send("POST", "", { url: "https://example.tumblr.com/post/832760197646860288" })).status, 400);
  for (const data of [
    { url: "https://not-tumblr.com/example/123" },
    { url: "javascript:alert(1)" },
    { url: "https://www.tumblr.com/example/123", note: "x".repeat(501) },
  ]) assert.equal((await send("POST", "", data)).status, 400);
  assert.deepEqual(await (await send("GET")).json(), [ask]);
  blog = "second";
  assert.equal((await send("DELETE", `/${ask.id}`, undefined, "first")).status, 409);
  assert.deepEqual(await (await send("GET")).json(), []);
  blog = "first";
  assert.equal((await send("DELETE", "/missing")).status, 404);
  assert.equal((await send("DELETE", `/${ask.id}`)).status, 204);
  assert.deepEqual(await (await send("GET")).json(), []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "asks_first.json"), "utf8")), []);
  fs.writeFileSync(path.join(dir, "asks_first.json"), JSON.stringify([{ id: "x", url: "javascript:alert(1)", note: "" }]));
  assert.equal((await send("GET")).status, 500);
  assert.equal((await send("POST", "", { url: "https://www.tumblr.com/example/123" })).status, 500);
});

test("updates thread flags and rejects invalid or stale changes", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-status-route-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let blog = "first";
  const store = createBlogThreadStore({ directory: dir, getBlog: () => blog });
  store.add("Story", "https://www.tumblr.com/root/123");
  const app = express();
  app.use("/api/threads", createThreadRoutes({ getBlog: () => blog, store }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/threads`;
  const patch = (suffix, body, header = "first") => fetch(`${base}${suffix}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", "X-Thread-Blog": header },
    body: JSON.stringify(body),
  });
  assert.equal((await patch("/root/123/status", { completed: "yes" })).status, 400);
  assert.equal((await patch("/root/123/status", {})).status, 400);
  assert.equal((await patch("/root/123/status", { completed: true, unexpected: true })).status, 400);
  assert.equal((await patch("/root/999/status", { completed: true })).status, 404);
  const result = await patch("/root/123/status", { completed: true, favourite: true });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).completed, true);
  assert.equal((await (await fetch(base)).json())[0].favourite, true);
  const edit = (body) => fetch(`${base}/root/123`, {
    method: "PUT", headers: { "Content-Type": "application/json", "X-Thread-Blog": "first" },
    body: JSON.stringify(body),
  });
  const details = { title: "Renamed", url: "https://www.tumblr.com/root/123" };
  assert.equal((await edit({ ...details, completed: "false" })).status, 400);
  assert.equal((await edit({ ...details, completed: false })).status, 200);
  assert.equal((await (await fetch(base)).json())[0].favourite, true);
  assert.equal((await (await fetch(base)).json())[0].completed, undefined);
  assert.equal((await edit({ ...details, completed: true })).status, 200);
  blog = "second";
  assert.equal((await patch("/root/123/status", { completed: false })).status, 409);
  blog = "first";
  assert.equal((await (await fetch(base)).json())[0].completed, true);
  assert.equal((await patch("/root/123/status", { completed: false })).status, 200);
  const saved = (await (await fetch(base)).json())[0];
  assert.equal(saved.completed, undefined);
  assert.equal(saved.favourite, true);
});

test("manages per-blog AUs and preserves assignments when threads are edited", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-au-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let blog = "first";
  const app = express();
  app.use("/api/threads", createThreadRoutes({
    getBlog: () => blog,
    store: createBlogThreadStore({ directory: dir, getBlog: () => blog }),
    auStore: (name) => createAuStore(name, dir),
  }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/threads`;
  const send = (url, method, data) => fetch(`${base}${url}`, {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  assert.deepEqual(await (await fetch(`${base}/aus`)).json(), []);
  const created = await send("/aus", "POST", { name: " Space " });
  assert.equal(created.status, 201);
  const au = await created.json();
  assert.equal(au.name, "Space");
  assert.equal(au.shortName, undefined);
  assert.equal(au.verseUrl, undefined);
  const withDetails = await send("/aus", "POST", { name: "Ocean", shortName: "Sea", verseUrl: "https://example.com/ocean" });
  assert.equal(withDetails.status, 201);
  const ocean = await withDetails.json();
  assert.equal(ocean.shortName, "Sea");
  assert.equal(ocean.verseUrl, "https://example.com/ocean");
  assert.equal((await fetch(`${base}/aus/${ocean.id}`, { method: "DELETE" })).status, 204);
  assert.equal((await send("/aus", "POST", { name: "space" })).status, 400);
  for (const verseUrl of ["javascript:alert(1)", "https://user:pass@example.com/", "not a url"]) {
    assert.equal((await send(`/aus/${au.id}`, "PUT", { name: "Bad", verseUrl })).status, 400);
  }
  assert.equal((await send(`/aus/${au.id}`, "PUT", { name: "Bad", shortName: "x".repeat(51) })).status, 400);
  assert.equal((await send(`/aus/${au.id}`, "PUT", {
    name: "Space", shortName: "  Stars  ", verseUrl: " https://example.com/verse "
  })).status, 200);
  let storedAu = (await (await fetch(`${base}/aus`)).json())[0];
  assert.equal(storedAu.name, "Space");
  assert.equal(storedAu.shortName, "Stars");
  assert.equal(storedAu.verseUrl, "https://example.com/verse");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "aus_first.json"), "utf8"))[0], storedAu);
  const thread = { title: "Story", url: "https://www.tumblr.com/root/123", auId: au.id };
  assert.equal((await send("", "POST", { ...thread, auId: "missing" })).status, 400);
  assert.equal((await send("", "POST", thread)).status, 201);
  assert.equal((await send("", "POST", { title: "Another", url: "https://www.tumblr.com/root/456" })).status, 201);
  assert.equal((await (await fetch(base)).json())[0].auId, au.id);
  assert.equal((await fetch(`${base}/aus/${au.id}`, { method: "DELETE" })).status, 409);
  assert.equal((await send(`/aus/${au.id}`, "PUT", { name: "New name" })).status, 200);
  storedAu = (await (await fetch(`${base}/aus`)).json())[0];
  assert.equal(storedAu.name, "New name");
  assert.equal(storedAu.shortName, "Stars");
  assert.equal(storedAu.verseUrl, "https://example.com/verse");
  assert.equal((await send(`/aus/${au.id}`, "PUT", { name: "New name", shortName: "", verseUrl: "" })).status, 200);
  storedAu = (await (await fetch(`${base}/aus`)).json())[0];
  assert.equal(storedAu.shortName, undefined);
  assert.equal(storedAu.verseUrl, undefined);
  assert.equal((await send("/root/123", "PUT", { title: "Edited", url: thread.url })).status, 200);
  assert.equal((await (await fetch(base)).json())[0].auId, au.id);
  blog = "second";
  assert.deepEqual(await (await fetch(`${base}/aus`)).json(), []);
  assert.deepEqual(await (await fetch(base)).json(), []);
  blog = "first";
  assert.equal((await send("/root/123", "PUT", { title: "Edited", url: thread.url, auId: null })).status, 200);
  assert.equal((await (await fetch(base)).json())[0].auId, undefined);
  assert.equal((await fetch(`${base}/aus/${au.id}`, { method: "DELETE" })).status, 204);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "aus_first.json"), "utf8")), []);
  fs.writeFileSync(path.join(dir, "aus_first.json"), JSON.stringify([{ id: "x", name: "Unsafe", verseUrl: "javascript:alert(1)" }]));
  assert.equal((await fetch(`${base}/aus`)).status, 500);
  fs.writeFileSync(path.join(dir, "aus_first.json"), "invalid json");
  assert.equal((await fetch(`${base}/aus`)).status, 500);
});

test("switches collections live and rejects stale or in-flight writes", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-switch-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let blog = "first";
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  let started;
  const startedRequest = new Promise((resolve) => { started = resolve; });
  const api = { get: async () => {
    started();
    await waiting;
    return { data: { response: { posts: [{ id_string: "123", blog_name: "root" }] } } };
  } };
  const app = express();
  app.use("/api/threads", createThreadRoutes({
    getBlog: () => blog,
    store: createBlogThreadStore({ directory: dir, getBlog: () => blog }),
    api, getApiKey: () => "key",
  }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/threads`;
  const headers = { "Content-Type": "application/json", "X-Thread-Blog": "first" };
  const pending = fetch(base, { method: "POST", headers, body: JSON.stringify({ title: "Waiting", blog: "root", postId: "123" }) });
  await startedRequest;
  blog = "second";
  release();
  assert.equal((await pending).status, 409);
  assert.equal((await fetch(base, { headers })).status, 409);
  assert.deepEqual(await (await fetch(base)).json(), []);
  const added = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json", "X-Thread-Blog": "second" }, body: JSON.stringify({ title: "Second", url: "https://www.tumblr.com/root/123" }) });
  assert.equal(added.status, 201);
  blog = "first";
  assert.deepEqual(await (await fetch(base)).json(), []);
  blog = "second";
  assert.equal((await (await fetch(base)).json())[0].title, "Second");
});

test("duplicate ID edits return the matching record without calling Tumblr", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-duplicate-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "threads.json");
  fs.writeFileSync(file, "[]");
  const store = createThreadStore(file);
  store.add("First", "https://www.tumblr.com/root/1");
  store.add("Matching thread", "https://www.tumblr.com/root/2");
  store.setFlags("root", "2", { completed: true, favourite: true });
  let calls = 0;
  const app = express();
  app.use("/api/threads", createThreadRoutes({
    store, getApiKey: () => "key", api: { get: async () => { calls++; throw new Error("Unexpected request"); } },
  }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const result = await fetch(`http://127.0.0.1:${server.address().port}/api/threads/root/1`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Edited", blog: "ROOT", postId: "2" }),
  });
  assert.equal(result.status, 400);
  const body = await result.json();
  assert.equal(body.error, "This post is already tracked.");
  assert.equal(body.duplicate.title, "Matching thread");
  assert.equal(body.duplicate.completed, true);
  assert.equal(body.duplicate.favourite, true);
  assert.equal(calls, 0);
  assert.equal(store.list()[0].title, "First");
});

test("concurrent ID additions report the record saved by the other request", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-duplicate-race-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "threads.json");
  fs.writeFileSync(file, "[]");
  const store = createThreadStore(file);
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  let bothStarted;
  const started = new Promise((resolve) => { bothStarted = resolve; });
  let requests = 0;
  const api = { get: async () => {
    if (++requests === 2) bothStarted();
    await waiting;
    return { data: { response: { posts: [{ id_string: "1", blog_name: "root" }] } } };
  } };
  const app = express();
  app.use("/api/threads", createThreadRoutes({ store, api, getApiKey: () => "key" }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/threads`;
  const add = (title) => fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, blog: "root", postId: "1" }),
  });
  const responses = Promise.all([add("First request"), add("Second request")]);
  await started;
  release();
  const results = await responses;
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 400]);
  const duplicate = await results.find((result) => result.status === 400).json();
  assert.equal(duplicate.duplicate.title, store.list()[0].title);
  assert.equal(store.list().length, 1);
});

test("thread endpoints persist entries and report per-thread Tumblr errors", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-route-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "threads.json");
  fs.writeFileSync(file, "[]");
  const api = { get: async () => ({ data: { response: { notes: [] } } }) };
  const app = express();
  app.use("/api/threads", createThreadRoutes({ store: createThreadStore(file), api, getApiKey: () => "key" }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });

  await t.test("post ID additions verify Tumblr before storing and support default and override blogs", async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-id-test-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, "threads.json");
    fs.writeFileSync(file, "[]");
    let key = "key";
    let behavior = "success";
    const requests = [];
    const api = { get: async (url, options) => {
      requests.push({ url, options });
      if (behavior === "404" || behavior === "429") {
        const error = new Error("upstream"); error.response = { status: Number(behavior) }; throw error;
      }
      if (behavior === "timeout") { const error = new Error("timeout"); error.code = "ECONNABORTED"; throw error; }
      if (behavior === "empty") return { data: { response: { posts: [] } } };
      if (behavior === "malformed") return { data: { response: {} } };
      const blog = url.match(/blog\/([^.]+)/)[1];
      return { data: { response: { posts: [{ id_string: options.params.id, blog_name: blog }] } } };
    } };
    const app = express();
    app.use("/api/threads", createThreadRoutes({ store: createThreadStore(file), api, getApiKey: () => key, getBlog: () => "default-blog" }));
    const server = await new Promise((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}/api/threads`;
    const add = (data) => fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    assert.deepEqual(await (await fetch(`${base}/config`)).json(), { defaultBlog: "default-blog" });
    assert.equal((await add({ title: "Bad", postId: "bad" })).status, 400);
    assert.equal((await add({ title: "Bad", blog: "bad.example", postId: "123" })).status, 400);
    assert.equal((await add({ title: "Bad", postId: 789524026478493696 })).status, 400);
    assert.equal((await add({ title: "Bad", url: "https://www.tumblr.com/blog/1", postId: "1" })).status, 400);
    assert.equal(requests.length, 0);
    key = "";
    assert.equal((await add({ title: "Missing key", postId: "123" })).status, 503);
    key = "key";
    for (const [mode, status] of [["404", 404], ["429", 502], ["timeout", 502], ["empty", 400], ["malformed", 502]]) {
      behavior = mode;
      assert.equal((await add({ title: mode, postId: "123" })).status, status, mode);
      assert.deepEqual(JSON.parse(fs.readFileSync(file)), []);
    }
    behavior = "success";
    const response = await add({ title: "Default", postId: "789524026478493696" });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).url, "https://www.tumblr.com/default-blog/789524026478493696");
    assert.equal((await add({ title: "Override", blog: "other", postId: "789524026478493697" })).status, 201);
    assert.equal(requests.at(-1).url, "https://api.tumblr.com/v2/blog/other.tumblr.com/posts");
    const callsBeforeDuplicate = requests.length;
    const duplicate = await add({ title: "Duplicate", postId: "789524026478493696" });
    assert.equal(duplicate.status, 400);
    assert.deepEqual((await duplicate.json()).duplicate, {
      title: "Default", blog: "default-blog", postId: "789524026478493696",
      url: "https://www.tumblr.com/default-blog/789524026478493696",
    });
    assert.equal(requests.length, callsBeforeDuplicate);
    const saved = JSON.parse(fs.readFileSync(file));
    assert.equal(saved.length, 2);
    assert.equal(saved[1].url, "https://www.tumblr.com/other/789524026478493697");
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/threads`;
  const add = (data) => fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  assert.equal((await add({ title: "invalid", url: "https://example.com" })).status, 400);
  const response = await add({ title: "My thread", url: "https://www.tumblr.com/blog/833900598515695616/example" });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).postId, "833900598515695616");
  const duplicate = await add({ title: "duplicate", url: "https://blog.tumblr.com/post/833900598515695616" });
  assert.equal(duplicate.status, 400);
  assert.deepEqual((await duplicate.json()).duplicate, {
    title: "My thread", blog: "blog", postId: "833900598515695616",
    url: "https://www.tumblr.com/blog/833900598515695616",
  });
  assert.equal((await (await fetch(base)).json()).length, 1);
  const url = `${base}/blog/833900598515695616`;
  const edit = (endpoint, data) => fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  assert.equal((await edit(`${base}/missing/123`, { title: "No", url: "https://www.tumblr.com/blog/123" })).status, 404);
  assert.equal((await edit(url, { title: "", url: "https://www.tumblr.com/blog/123" })).status, 400);
  const renamed = await edit(url, { title: "Renamed", url: "https://blog.tumblr.com/post/833900598515695616" });
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).title, "Renamed");
  assert.equal((await add({ title: "Other", url: "https://www.tumblr.com/other/123" })).status, 201);
  const duplicateEdit = await edit(url, { title: "Duplicate", url: "https://www.tumblr.com/other/123" });
  assert.equal(duplicateEdit.status, 400);
  assert.equal((await duplicateEdit.json()).duplicate.title, "Other");
  assert.equal((await (await fetch(base)).json())[0].title, "Renamed");
  assert.equal((await edit(url, { title: "ID rename", blog: "blog", postId: "833900598515695616" })).status, 200);
  const unverifiable = await edit(url, { title: "Changed", blog: "blog", postId: "123" });
  assert.equal(unverifiable.status, 502);
  assert.equal((await (await fetch(base)).json())[0].title, "ID rename");
  api.get = async (apiUrl, options) => ({ data: { response: { posts: [{ blog_name: "new-blog", id_string: options.params.id }] } } });
  const moved = await edit(url, { title: "Moved", blog: "new-blog", postId: "789524026478493696" });
  assert.equal(moved.status, 200);
  assert.equal((await moved.json()).url, "https://www.tumblr.com/new-blog/789524026478493696");
  assert.equal((await edit(url, { title: "Stale", url: "https://www.tumblr.com/blog/123" })).status, 404);
  const movedUrl = `${base}/new-blog/789524026478493696`;
  api.get = async (apiUrl) => apiUrl.endsWith("/notes")
    ? ({ data: { response: { notes: [] } } })
    : ({ data: { response: { posts: [{ blog_name: "new-blog", id_string: "789524026478493696", timestamp: 1700000000 }] } } });
  assert.deepEqual(await (await fetch(`${movedUrl}/reblog`)).json(), {
    lastReblog: null,
    savedPost: { blog: "new-blog", timestamp: 1700000000, url: "https://www.tumblr.com/new-blog/789524026478493696" },
  });
  api.get = async () => { const error = new Error("rate limited"); error.response = { status: 429 }; throw error; };
  const failure = await fetch(`${movedUrl}/reblog`);
  assert.equal(failure.status, 502);
  assert.match((await failure.json()).error, /429/);
  assert.equal((await fetch(movedUrl, { method: "DELETE" })).status, 204);
  assert.equal((await fetch(`${movedUrl}/reblog`)).status, 404);
  assert.equal((await fetch(movedUrl, { method: "DELETE" })).status, 404);
  fs.writeFileSync(file, "broken json");
  assert.equal((await fetch(base)).status, 500);
  assert.equal((await add({ title: "other", url: "https://www.tumblr.com/blog/123" })).status, 500);
});
