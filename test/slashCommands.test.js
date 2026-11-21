"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MessageFlags } = require("discord.js");
const { SlashCommands: BaseSlashCommands, commands } = require("../src/discord/slashCommands");
const { createSlashAudit } = require("../src/discord/slashAudit");
const { createThreadStore } = require("../src/threads/threadTracker");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

class SlashCommands extends BaseSlashCommands {
  constructor(options = {}) {
    super({ audit: { write() {} }, ...options });
  }
}

function interaction(commandName, subcommand, values = {}, user = "123") {
  const calls = [];
  return {
    commandName, user: { id: user }, calls,
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => subcommand,
      getString: (name) => values[name] ?? null,
      getInteger: (name) => values[name] ?? null,
      getBoolean: (name) => values[name] ?? null,
    },
    reply: async (value) => calls.push({ kind: "reply", value }),
    deferReply: async (value) => calls.push({ kind: "defer", value }),
    editReply: async (value) => calls.push({ kind: "edit", value }),
  };
}

test("slash definitions include every requested command and options", () => {
  assert.deepEqual(commands.map((command) => command.name), ["thread", "blog", "followers"]);
  assert.deepEqual(commands[0].options.map((option) => option.name), ["add", "list", "latest", "remove"]);
  assert.deepEqual(commands[1].options.map((option) => option.name), ["recent"]);
  assert.deepEqual(commands[2].options.map((option) => option.name), ["snapshot", "compare"]);
});

test("slash commands deny unconfigured and non-owner users before touching data", async () => {
  let touched = false;
  const store = { list: () => { touched = true; return []; } };
  for (const owner of ["", "not-an-id", "999"]) {
    const handler = new SlashCommands({ store, getOwner: () => owner });
    const request = interaction("thread", "list");
    await handler.handle(request);
    assert.equal(request.calls[0].kind, "reply");
    assert.equal(request.calls[0].value.flags, MessageFlags.Ephemeral);
    assert.match(request.calls[0].value.content, /restricted/);
  }
  assert.equal(touched, false);
});

test("owner thread commands defer publicly, share the store, paginate and require removal confirmation", async () => {
  const records = [];
  const store = {
    add: (title, url) => { const result = { title, url: "https://www.tumblr.com/blog/123", blog: "blog", postId: "123" }; records.push(result); return result; },
    list: () => records,
    remove: (blog, postId) => { const index = records.findIndex((r) => r.blog === blog && r.postId === postId); if (index < 0) return false; records.splice(index, 1); return true; },
  };
  const api = { get: async () => ({ data: { response: { notes: [{ type: "reblog", blog_name: "poster", timestamp: 1700000000, post_id: "789524026478493696" }] } } }) };
  const handler = new SlashCommands({ store, api, getOwner: () => "123", getApiKey: () => "key" });
  const add = interaction("thread", "add", { title: "Test @everyone", url: "https://www.tumblr.com/blog/123" });
  await handler.handle(add);
  assert.equal(add.calls[0].value, undefined);
  assert.deepEqual(add.calls[1].value.allowedMentions, { parse: [] });
  assert.equal(records.length, 1);
  const list = interaction("thread", "list");
  await handler.handle(list);
  assert.match(list.calls[1].value.content, /Test @everyone/);
  const latest = interaction("thread", "latest", { url: "https://www.tumblr.com/blog/123" });
  await handler.handle(latest);
  assert.match(latest.calls[1].value.content, /poster/);
  assert.match(latest.calls[1].value.content, /any branch/);
  const cancel = interaction("thread", "remove", { url: "https://www.tumblr.com/blog/123", confirm: false });
  await handler.handle(cancel);
  assert.equal(records.length, 1);
  const remove = interaction("thread", "remove", { url: "https://www.tumblr.com/blog/123", confirm: true });
  await handler.handle(remove);
  assert.equal(records.length, 0);
  const missing = interaction("thread", "latest", { url: "https://www.tumblr.com/blog/123" });
  await handler.handle(missing);
  assert.match(missing.calls[1].value.content, /not found/);
});

test("list stays within Discord's message limit and checks page bounds", async () => {
  const threads = Array.from({ length: 10 }, (_, i) => ({ title: "*".repeat(200), url: `https://www.tumblr.com/blog/${i}` }));
  const handler = new SlashCommands({ store: { list: () => threads }, getOwner: () => "123" });
  const list = interaction("thread", "list", { page: 1 });
  await handler.handle(list);
  assert.ok(list.calls[1].value.content.length <= 2000);
  assert.match(list.calls[1].value.content, /page 1\//);
  const bad = interaction("thread", "list", { page: 999 });
  await handler.handle(bad);
  assert.match(bad.calls[1].value.content, /does not exist/);
});

test("latest command reports saved post author and date when there are no reblogs", async () => {
  const thread = { title: "Thread", blog: "blog", postId: "123", url: "https://www.tumblr.com/blog/123" };
  const api = { get: async (url) => url.endsWith("/notes")
    ? ({ data: { response: { notes: [] } } })
    : ({ data: { response: { posts: [{ id_string: "123", blog_name: "blog", timestamp: 1700000000 }] } } }) };
  const handler = new SlashCommands({ store: { list: () => [thread] }, api, getOwner: () => "123", getApiKey: () => "key" });
  const request = interaction("thread", "latest", { url: thread.url });
  await handler.handle(request);
  assert.match(request.calls[1].value.content, /No reblogs found\. Saved post by: blog/);
  assert.match(request.calls[1].value.content, /2023-11-14T22:13:20\.000Z/);
});

test("recent posts, snapshots and comparisons use requested services with public responses", async () => {
  const api = { get: async (url, options) => {
    assert.match(url, /other\.tumblr\.com\/posts/);
    assert.equal(options.params.limit, 5);
    return { data: { response: { posts: [{ id_string: "789524026478493696" }] } } };
  } };
  const snapshots = {
    snapshot: async (blog) => ({ blog, count: 2, createdAt: "2026-01-01T00:00:00.000Z" }),
    compare: (blog) => ({ blog, previous: "2026-01-01", latest: "2026-02-01", newFollowers: ["one"], missingFollowers: ["two"] }),
  };
  const handler = new SlashCommands({ api, snapshots, getOwner: () => "123", getApiKey: () => "key", getBlog: () => "other" });
  const recent = interaction("blog", "recent");
  await handler.handle(recent);
  assert.match(recent.calls[1].value.content, /other\/789524026478493696/);
  const snapshot = interaction("followers", "snapshot");
  await handler.handle(snapshot);
  assert.match(snapshot.calls[1].value.content, /2 followers/);
  const compare = interaction("followers", "compare");
  await handler.handle(compare);
  assert.equal(compare.calls[0].value, undefined);
  assert.deepEqual(JSON.parse(compare.calls[1].value.files[0].attachment.toString()).newFollowers, ["one"]);
});

test("audit records command inputs, outcomes, and response text but not attachment contents", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slash-audit-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const snapshots = {
    compare: () => ({ blog: "blog", previous: "2026-01-01", latest: "2026-02-01", newFollowers: ["private-name"], missingFollowers: [] }),
  };
  const handler = new SlashCommands({ audit: createSlashAudit(dir), snapshots, getOwner: () => "123", getBlog: () => "blog" });
  const request = interaction("followers", "compare", { blog: "blog" });
  request.id = "interaction-id";
  request.guildId = "guild-id";
  request.channelId = "channel-id";
  await handler.handle(request);
  const text = fs.readFileSync(path.join(dir, "commands.jsonl"), "utf8");
  assert.doesNotMatch(text, /private-name/);
  const entries = text.trim().split("\n").map(JSON.parse);
  assert.deepEqual(entries.map((entry) => entry.phase), ["started", "completed"]);
  assert.equal(entries[0].options.blog, "blog");
  assert.equal(entries[0].interactionId, "interaction-id");
  assert.equal(entries[1].outcome, "success");
  assert.equal(entries[1].response, request.calls[1].value.content);
  assert.deepEqual(entries[1].attachments, ["follower-comparison.json"]);
  assert.match(entries[1].timestamp, /^\d{4}-/);
});

test("audit strips URL query strings and credentials from inputs", async () => {
  const entries = [];
  const handler = new SlashCommands({
    audit: { write: (entry) => entries.push(entry) },
    store: { list: () => [] },
    getOwner: () => "123",
  });
  await handler.handle(interaction("thread", "latest", { url: "https://www.tumblr.com/blog/123?token=secret#fragment" }));
  assert.equal(entries[0].options.url, "https://www.tumblr.com/blog/123");
  assert.doesNotMatch(JSON.stringify(entries), /secret|fragment/);
});

test("audit failures are reported without falsely claiming command success", async () => {
  let touched = false;
  const blocked = new SlashCommands({
    audit: { write() { throw new Error("disk"); } },
    store: { list() { touched = true; return []; } },
    getOwner: () => "123",
  });
  const request = interaction("thread", "list");
  await blocked.handle(request);
  assert.equal(touched, false);
  assert.match(request.calls[1].value.content, /command was not run/i);
  let writes = 0;
  const failing = new SlashCommands({
    audit: { write() { if (++writes === 2) throw new Error("disk"); } },
    store: { list: () => [] },
    getOwner: () => "123",
  });
  const completed = interaction("thread", "list");
  await failing.handle(completed);
  assert.match(completed.calls[1].value.content, /command ran.*could not be written/i);
});

test("audit records failures, denied access, and failed response delivery", async () => {
  const entries = [];
  const handler = new SlashCommands({
    audit: { write: (entry) => entries.push(entry) },
    api: { get: async () => { const error = new Error("private secret"); error.response = { status: 429 }; throw error; } },
    getOwner: () => "123", getBlog: () => "blog", getApiKey: () => "key",
  });
  await handler.handle(interaction("thread", "list", {}, "999"));
  assert.equal(entries[0].phase, "denied");
  const request = interaction("blog", "recent");
  await handler.handle(request);
  assert.equal(entries[2].outcome, "error");
  assert.match(entries[2].response, /rate limit/i);
  assert.doesNotMatch(JSON.stringify(entries), /private secret/);
  const failedDelivery = interaction("thread", "list");
  failedDelivery.editReply = async () => { throw new Error("Discord offline"); };
  handler.store = { list: () => [] };
  await assert.rejects(handler.handle(failedDelivery), /Discord offline/);
  assert.equal(entries.at(-1).phase, "delivery_failed");
});

test("snapshot and compare commands warn when saved data may be incomplete", async () => {
  const quality = { incomplete: true, duplicateCount: 2, reportedTotal: 3, retrySkipped: false };
  const snapshots = {
    snapshot: async () => ({ blog: "blog", count: 1, createdAt: "2026-01-01", quality }),
    compare: () => ({ previous: "2026-01-01", latest: "2026-02-01", previousQuality: quality, latestQuality: null, newFollowers: [], missingFollowers: [] }),
  };
  const handler = new SlashCommands({ snapshots, getOwner: () => "123", getBlog: () => "blog" });
  const snapshot = interaction("followers", "snapshot");
  await handler.handle(snapshot);
  assert.match(snapshot.calls[1].value.content, /2 duplicate entries/);
  assert.match(snapshot.calls[1].value.content, /may be incomplete/);
  const compare = interaction("followers", "compare");
  await handler.handle(compare);
  assert.match(compare.calls[1].value.content, /may be inaccurate/);
  assert.equal(JSON.parse(compare.calls[1].value.files[0].attachment.toString()).previousQuality.incomplete, true);
});

test("upstream rate limits and unexpected errors are surfaced without leaking secrets", async () => {
  for (const error of [Object.assign(new Error("secret-token"), { response: { status: 429 } }), new Error("secret-token")]) {
    const handler = new SlashCommands({ api: { get: async () => { throw error; } }, getOwner: () => "123", getApiKey: () => "key", getBlog: () => "blog" });
    const request = interaction("blog", "recent");
    await handler.handle(request);
    assert.doesNotMatch(request.calls[1].value.content, /secret-token/);
    if (error.response) assert.match(request.calls[1].value.content, /rate limit/i);
  }
});

test("slash thread changes persist in the same JSON store used by the web tracker", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slash-store-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "threads.json");
  fs.writeFileSync(file, "[]");
  const store = createThreadStore(file);
  const handler = new SlashCommands({ store, getOwner: () => "123" });
  const add = interaction("thread", "add", { title: "Shared", url: "https://www.tumblr.com/blog/789524026478493696" });
  await handler.handle(add);
  assert.equal(createThreadStore(file).list()[0].title, "Shared");
  const remove = interaction("thread", "remove", { url: "https://www.tumblr.com/blog/789524026478493696", confirm: true });
  await handler.handle(remove);
  assert.deepEqual(createThreadStore(file).list(), []);
});
