"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createThreadStore, createBlogThreadStore, getLastReblog, parsePostUrl, postFromId, verifyPost } = require("../src/threads/threadTracker");
const { getDefaultBlog, createThreadBlogResolver } = require("../src/config/blogConfig");

const postUrl = "https://www.tumblr.com/iobartach/833900598515695616/gravegotten-asked?source=share";

test("resolves configured blog and fallback", (t) => {
  const original = process.env.BLOG_NAME;
  t.after(() => {
    if (original === undefined) delete process.env.BLOG_NAME;
    else process.env.BLOG_NAME = original;
  });
  process.env.BLOG_NAME = " my-blog ";
  assert.equal(getDefaultBlog(), "my-blog");
  process.env.BLOG_NAME = " ";
  assert.equal(getDefaultBlog(), "iobartach");
  delete process.env.BLOG_NAME;
  assert.equal(getDefaultBlog(), "iobartach");
});

test("reads thread blog changes from dotenv and falls back to the startup environment", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-config-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const envFile = path.join(dir, ".env");
  const resolve = createThreadBlogResolver({ envFile, environmentBlog: "external" });
  assert.equal(resolve(), "external");
  fs.writeFileSync(envFile, 'BLOG_NAME=" First-Blog "\n');
  assert.equal(resolve(), "First-Blog");
  fs.writeFileSync(envFile, "BLOG_NAME=second-blog\n");
  assert.equal(resolve(), "second-blog");
  fs.writeFileSync(envFile, "BLOG_NAME=\n");
  assert.equal(resolve(), "iobartach");
  fs.writeFileSync(envFile, "OTHER=value\n");
  assert.equal(resolve(), "external");
});

test("migrates once and isolates per-blog thread collections", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-collections-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const legacy = path.join(dir, "tracked_threads.json");
  const old = [{ title: "Existing", url: postUrl }];
  fs.writeFileSync(legacy, JSON.stringify(old));
  let blog = " First-Blog ";
  const store = createBlogThreadStore({ directory: dir, getBlog: () => blog });
  assert.equal(store.list()[0].title, "Existing");
  assert.deepEqual(JSON.parse(fs.readFileSync(legacy)), old);
  assert.ok(fs.existsSync(path.join(dir, "tracked_threads_first-blog.json")));
  blog = "other";
  assert.deepEqual(store.list(), []);
  store.add("Other", "https://www.tumblr.com/root/123");
  blog = "FIRST-BLOG";
  assert.equal(store.list()[0].title, "Existing");
  store.add("First", "https://www.tumblr.com/root/123");
  blog = "other";
  assert.deepEqual(store.list().map((thread) => thread.title), ["Other"]);
  blog = "migration";
  store.add("Migration", "https://www.tumblr.com/root/456");
  assert.equal(store.list()[0].title, "Migration");
  blog = "../bad";
  assert.throws(() => store.list(), /BLOG_NAME/);
  blog = "first-blog";
  fs.unlinkSync(path.join(dir, "tracked_threads_first-blog.json"));
  assert.deepEqual(store.list(), []);
});

test("does not overwrite an existing collection during migration", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-existing-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "tracked_threads.json"), JSON.stringify([{ title: "Old", url: postUrl }]));
  fs.writeFileSync(path.join(dir, "tracked_threads_blog.json"), JSON.stringify([{ title: "New", url: postUrl }]));
  const store = createBlogThreadStore({ directory: dir, getBlog: () => "blog" });
  assert.equal(store.list()[0].title, "New");
  assert.deepEqual(store.forBlog("other").list(), []);
});

test("validates blog and post ID as strings", () => {
  assert.deepEqual(postFromId(" IoBartach ", " 789524026478493696 "), {
    blog: "iobartach", postId: "789524026478493696",
    url: "https://www.tumblr.com/iobartach/789524026478493696",
  });
  for (const [blog, id] of [["bad.example", "123"], ["", "123"], ["blog", "12a"], ["blog", 789524026478493696]]) {
    assert.throws(() => postFromId(blog, id));
  }
});

test("verifies the exact Tumblr post with a lossless string ID", async () => {
  const thread = postFromId("iobartach", "789524026478493696");
  const api = { get: async (url, options) => {
    assert.equal(url, "https://api.tumblr.com/v2/blog/iobartach.tumblr.com/posts");
    assert.deepEqual(options.params, { id: thread.postId, api_key: "key" });
    assert.equal(options.timeout, 10000);
    return { data: { response: { posts: [{ id_string: thread.postId, blog_name: "iobartach" }] } } };
  } };
  await verifyPost(thread, "key", api);
  const response = (posts) => ({ get: async () => ({ data: { response: { posts } } }) });
  await assert.rejects(verifyPost(thread, "", api), /CONSUMER_KEY/);
  await assert.rejects(verifyPost(thread, "key", response([])), /not found or inaccessible/);
  await assert.rejects(verifyPost(thread, "key", response([{ id_string: "999", blog_name: "iobartach" }])), /unexpected/);
  await assert.rejects(verifyPost(thread, "key", response([{ id_string: thread.postId, blog_name: "other" }])), /unexpected/);
  await assert.rejects(verifyPost(thread, "key", { get: async () => ({ data: {} }) }), /unexpected/);
});

test("parses Tumblr URLs and preserves large post IDs", () => {
  const expected = {
    blog: "iobartach",
    postId: "833900598515695616",
    url: "https://www.tumblr.com/iobartach/833900598515695616",
  };
  assert.deepEqual(parsePostUrl(postUrl), expected);
  assert.deepEqual(parsePostUrl("https://IOBARTACH.tumblr.com/post/833900598515695616/slug"), expected);
  for (const invalid of [
    "https://tumblr.com.evil.example/blog/123",
    "http://www.tumblr.com/blog/123",
    "https://www.tumblr.com/blog/not-a-number",
    "https://blog.tumblr.com/123",
    "https://user@www.tumblr.com/blog/123",
    "not a url",
  ]) {
    assert.throws(() => parsePostUrl(invalid));
  }
});

test("stores, reloads, deduplicates and removes threads without losing precision", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "threads.json");
  fs.writeFileSync(file, "[]");
  const store = createThreadStore(file);
  const saved = store.add("  An adventure  ", postUrl);
  assert.equal(saved.title, "An adventure");
  assert.deepEqual(store.list(), [saved]);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), [{ title: "An adventure", url: saved.url }]);
  assert.throws(() => store.add("Duplicate", "https://iobartach.tumblr.com/post/833900598515695616"));
  assert.throws(() => store.add("", postUrl));
  assert.equal(store.remove(saved.blog, saved.postId), true);
  assert.equal(store.remove(saved.blog, saved.postId), false);
  assert.deepEqual(store.list(), []);
  fs.writeFileSync(file, '[{"title":"broken","url":"not a url"}]');
  assert.throws(() => store.list(), /invalid URL/);
});

test("updates a tracked thread in place without overwriting another thread", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-update-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "threads.json");
  fs.writeFileSync(file, "[]");
  const store = createThreadStore(file);
  const first = store.add("First", postUrl);
  const second = store.add("Second", "https://www.tumblr.com/other/123");
  assert.equal(store.update("missing", "123", "None", postUrl), null);
  assert.throws(() => store.update(first.blog, first.postId, " ", first.url), /title/);
  assert.throws(() => store.update(first.blog, first.postId, "Renamed", second.url), /already tracked/);
  assert.deepEqual(store.list(), [first, second]);
  const renamed = store.update(first.blog, first.postId, " Renamed ", first.url);
  assert.equal(renamed.title, "Renamed");
  const moved = store.update(first.blog, first.postId, "Changed", "https://new-blog.tumblr.com/post/789524026478493696");
  assert.equal(moved.url, "https://www.tumblr.com/new-blog/789524026478493696");
  assert.deepEqual(store.list(), [moved, second]);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), [
    { title: "Changed", url: moved.url },
    { title: "Second", url: second.url },
  ]);
});

test("persists completion and favourite flags through other thread changes", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-flags-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "threads.json");
  fs.writeFileSync(file, JSON.stringify([{ title: "Existing", url: postUrl }]));
  const store = createThreadStore(file);
  const first = store.list()[0];
  assert.equal(first.completed, undefined);
  assert.equal(first.favourite, undefined);
  assert.equal(store.setFlags("missing", "123", { completed: true }), null);
  for (const flags of [{}, { completed: "true" }, { favourite: null }, { unknown: true }]) {
    assert.throws(() => store.setFlags(first.blog, first.postId, flags), /boolean/);
  }
  store.setFlags(first.blog, first.postId, { completed: true, favourite: true });
  store.add("Second", "https://www.tumblr.com/other/123");
  const edited = store.update(first.blog, first.postId, "Edited", "https://www.tumblr.com/new-blog/456");
  assert.equal(edited.completed, true);
  assert.equal(edited.favourite, true);
  assert.equal(store.list()[0].completed, true);
  assert.equal(store.list()[0].favourite, true);
  assert.equal(JSON.parse(fs.readFileSync(file))[0].favourite, true);
  store.setFlags("new-blog", "456", { completed: false });
  assert.equal(store.list()[0].completed, undefined);
  assert.equal(store.list()[0].favourite, true);
  store.setFlags("new-blog", "456", { favourite: false });
  assert.equal(store.list()[0].favourite, undefined);
  fs.writeFileSync(file, JSON.stringify([{ title: "Invalid", url: postUrl, completed: "false" }]));
  assert.throws(() => store.list(), /invalid completed flag/);
});

test("assigns stable per-partner numbers without changing legacy titles or backup data", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-partner-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const legacy = path.join(dir, "tracked_threads.json");
  const entries = [
    { title: "w/ River | first", url: "https://www.tumblr.com/root/1", custom: "preserve", favourite: true },
    { title: "w/ RIVER | second", url: "https://www.tumblr.com/root/2", completed: true },
    { title: "w/ Alex | first", url: "https://www.tumblr.com/root/3" },
    { title: "Unformatted", url: "https://www.tumblr.com/root/4" },
  ];
  fs.writeFileSync(legacy, JSON.stringify(entries));
  const store = createBlogThreadStore({ directory: dir, getBlog: () => "blog" });
  let threads = store.list();
  assert.deepEqual(threads.map((thread) => thread.partnerNumber), [1, 2, 1, undefined]);
  assert.deepEqual(threads.map((thread) => thread.partner), ["River", "RIVER", "Alex", undefined]);
  assert.deepEqual(JSON.parse(fs.readFileSync(legacy)), entries);
  const collection = path.join(dir, "tracked_threads_blog.json");
  assert.equal(JSON.parse(fs.readFileSync(collection))[0].custom, "preserve");
  const original = fs.readFileSync(collection, "utf8");
  store.list();
  assert.equal(fs.readFileSync(collection, "utf8"), original);
  const added = store.add("w/ river | n/a", "https://www.tumblr.com/root/5");
  assert.equal(added.partnerNumber, 3);
  const renamed = store.update("root", "2", "w/ river | updated", "https://www.tumblr.com/root/2");
  assert.equal(renamed.partnerNumber, 2);
  assert.equal(renamed.completed, true);
  const moved = store.update("root", "2", "w/ Alex | updated", "https://www.tumblr.com/root/2");
  assert.equal(moved.partnerNumber, 2);
  assert.equal(moved.completed, true);
  store.setFlags("root", "5", { favourite: true });
  threads = store.list();
  assert.equal(threads.find((thread) => thread.postId === "1").partnerNumber, 1);
  assert.equal(threads.find((thread) => thread.postId === "5").partnerNumber, 3);
  assert.equal(threads.find((thread) => thread.postId === "5").favourite, true);
  fs.writeFileSync(collection, JSON.stringify([
    { title: "w/ River | new", url: "https://www.tumblr.com/root/1" },
    { title: "w/ river | numbered", url: "https://www.tumblr.com/root/2", partnerNumber: 7 },
  ]));
  assert.deepEqual(store.list().map((thread) => thread.partnerNumber), [8, 7]);
  const invalid = [
    { title: "w/ river | a", url: "https://www.tumblr.com/root/1", partnerNumber: 1 },
    { title: "w/ RIVER | b", url: "https://www.tumblr.com/root/2", partnerNumber: 1 },
  ];
  fs.writeFileSync(collection, JSON.stringify(invalid));
  assert.throws(() => store.list(), /duplicate writing partner numbers/);
  assert.deepEqual(JSON.parse(fs.readFileSync(collection)), invalid);
});

test("requests newest reblog from Tumblr and returns its blog, date and safe post URL", async () => {
  const thread = parsePostUrl(postUrl);
  const api = {
    async get(url, options) {
      assert.equal(url, "https://api.tumblr.com/v2/blog/iobartach.tumblr.com/notes");
      assert.deepEqual(options.params, { id: "833900598515695616", mode: "reblogs_with_tags", api_key: "key" });
      assert.equal(options.timeout, 10000);
      return { data: { response: { notes: [
        { type: "reblog", blog_name: "Partner", timestamp: 1700000000, post_id: "833900598515695617" },
        { type: "reblog", blog_name: "older", timestamp: 1600000000, post_id: "2" },
      ] } } };
    },
  };
  assert.deepEqual(await getLastReblog(thread, "key", api), {
    lastReblog: {
      blog: "Partner",
      timestamp: 1700000000,
      url: "https://www.tumblr.com/partner/833900598515695617",
    },
  });
});

test("distinguishes no reblogs, malformed responses, missing key and upstream errors", async () => {
  const thread = parsePostUrl(postUrl);
  const apiFor = (response) => ({ get: async () => ({ data: { response } }) });
  const savedPost = { id_string: thread.postId, blog_name: "IOBARTACH", timestamp: 1700000000 };
  const noReblogApi = (post) => ({ get: async (url, options) => {
    if (url.endsWith("/notes")) return { data: { response: { notes: [] } } };
    assert.equal(url, "https://api.tumblr.com/v2/blog/iobartach.tumblr.com/posts");
    assert.equal(options.params.id, thread.postId);
    return { data: { response: { posts: [post] } } };
  } });
  assert.deepEqual(await getLastReblog(thread, "key", noReblogApi(savedPost)), {
    lastReblog: null, savedPost: { blog: "IOBARTACH", timestamp: 1700000000, url: thread.url },
  });
  await assert.rejects(getLastReblog(thread, "key", noReblogApi({ ...savedPost, timestamp: undefined })), /invalid saved post date/);
  await assert.rejects(getLastReblog(thread, "key", noReblogApi({ ...savedPost, timestamp: 1e100 })), /invalid saved post date/);
  await assert.rejects(getLastReblog(thread, "key", noReblogApi({ ...savedPost, id_string: "other" })), /unexpected post response/);
  await assert.rejects(getLastReblog(thread, "key", { get: async (url) => {
    if (url.endsWith("/notes")) return { data: { response: { notes: [] } } };
    throw new Error("post lookup failed");
  } }), /post lookup failed/);
  await assert.rejects(getLastReblog(thread, "", apiFor({ notes: [] })), /CONSUMER_KEY/);
  await assert.rejects(getLastReblog(thread, "key", apiFor({})), /unexpected/);
  await assert.rejects(getLastReblog(thread, "key", apiFor({ notes: [], _links: { next: {} } })), /incomplete page/);
  await assert.rejects(getLastReblog(thread, "key", apiFor({ notes: [{ type: "reblog" }] })), /incomplete reblog/);
  const noSafeId = await getLastReblog(thread, "key", apiFor({ notes: [
    { type: "reblog", blog_name: "other", timestamp: 123, post_id: 833900598515695616 },
  ] }));
  assert.equal(noSafeId.lastReblog.url, null);
  await assert.rejects(getLastReblog(thread, "key", { get: async () => { throw new Error("offline"); } }), /offline/);
});
