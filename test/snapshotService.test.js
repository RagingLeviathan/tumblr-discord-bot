"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createFollowerSnapshots } = require("../src/followers/snapshotService");

const env = { CONSUMER_KEY: "key", CONSUMER_SECRET: "secret", OAUTH_KEY: "oauth", OAUTH_SECRET: "oauth-secret" };

test("snapshots paginate with signed OAuth, persist privately and compare exact names", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "snapshots-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let round = 1;
  let clock = Date.parse("2026-01-01T00:00:00Z");
  const api = { get: async (url, options) => {
    assert.match(options.headers.Authorization, /^OAuth /);
    const params = new URL(url).searchParams;
    assert.equal(params.get("limit"), "20");
    const offset = Number(params.get("offset"));
    const names = Array.from({ length: 21 }, (_, i) => `follower${i}`);
    if (round === 2) names[20] = "new-follower";
    return { data: { response: { total_users: names.length, users: names.slice(offset, offset + 20).map((name) => ({ name })) } } };
  } };
  const service = createFollowerSnapshots({ directory, api, env, delay: async () => {}, now: () => clock });
  assert.equal((await service.snapshot("My-Blog")).count, 21);
  round = 2; clock += 1000;
  await service.snapshot("my-blog");
  const report = service.compare("my-blog");
  assert.deepEqual(report.newFollowers, ["new-follower"]);
  assert.deepEqual(report.missingFollowers, ["follower20"]);
  assert.equal(fs.readdirSync(path.join(directory, "my-blog")).length, 2);
});

test("does not save partial snapshots for invalid, changing, stalled or failed pages", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "snapshots-fail-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const scenarios = [
    () => ({ total_users: 1, users: [] }),
    () => ({ total_users: 1, users: [{}] }),
    () => ({ total_users: 0, users: [{ name: "extra" }] }),
  ];
  for (const scenario of scenarios) {
    const service = createFollowerSnapshots({ directory, env, delay: async () => {}, api: { get: async () => ({ data: { response: scenario() } }) } });
    await assert.rejects(service.snapshot("blog"));
    assert.equal(fs.existsSync(path.join(directory, "blog")), false);
  }
  let count = 0;
  const service = createFollowerSnapshots({ directory, env, delay: async () => {}, api: { get: async () => ({ data: { response: ++count === 1
    ? { total_users: 21, users: Array.from({ length: 20 }, (_, i) => ({ name: `n${i}` })) }
    : { total_users: 20, users: [] } } }) } });
  await assert.rejects(service.snapshot("blog"), /changed/);
  assert.equal(fs.existsSync(path.join(directory, "blog")), false);
  await assert.rejects(createFollowerSnapshots({ directory, env: {} }).snapshot("blog"), /require/);
  assert.throws(() => service.compare("blog"), /two snapshots/);
  const offline = createFollowerSnapshots({ directory, env, api: { get: async () => {
    const error = new Error("offline"); error.response = { status: 429 }; throw error;
  } } });
  await assert.rejects(offline.snapshot("blog"), /offline/);
  assert.equal(fs.existsSync(path.join(directory, "blog")), false);
});

test("retries duplicated names and saves a clean retry without a warning", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "snapshots-retry-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let requests = 0;
  const service = createFollowerSnapshots({ directory, env, delay: async () => {}, api: { get: async () => ({
    data: { response: { total_users: 2, users: ++requests === 1
      ? [{ name: "same" }, { name: "Same" }]
      : [{ name: "same" }, { name: "other" }] } },
  }) } });
  const result = await service.snapshot("blog");
  assert.equal(requests, 2);
  assert.equal(result.count, 2);
  assert.deepEqual(result.quality, { incomplete: false, duplicateCount: 0, reportedTotal: 2, retrySkipped: false });
});

test("marks persistent duplicate snapshots incomplete and carries warnings into comparison", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "snapshots-duplicates-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let round = 1;
  let clock = Date.parse("2026-01-01T00:00:00Z");
  let requests = 0;
  const service = createFollowerSnapshots({ directory, env, delay: async () => {}, now: () => clock, api: { get: async () => {
    requests++;
    return { data: { response: { total_users: 2, users: round === 1
      ? [{ name: "Alice" }, { name: "alice" }]
      : [{ name: "Alice" }, { name: "Bob" }] } } };
  } } });
  const incomplete = await service.snapshot("blog");
  assert.equal(requests, 2);
  assert.equal(incomplete.count, 1);
  assert.deepEqual(incomplete.quality, { incomplete: true, duplicateCount: 1, reportedTotal: 2, retrySkipped: false });
  const file = path.join(directory, "blog", fs.readdirSync(path.join(directory, "blog"))[0]);
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(saved.followers, ["Alice"]);
  assert.deepEqual(saved.quality, incomplete.quality);
  round = 2;
  clock += 1000;
  await service.snapshot("blog");
  const report = service.compare("blog");
  assert.deepEqual(report.previousQuality, incomplete.quality);
  assert.equal(report.latestQuality.incomplete, false);
  assert.deepEqual(report.newFollowers, ["Bob"]);
});

test("counts duplicates across pagination boundaries and still advances by entries received", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "snapshots-overlap-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const offsets = [];
  const service = createFollowerSnapshots({ directory, env, delay: async () => {}, api: { get: async (url) => {
    const offset = Number(new URL(url).searchParams.get("offset"));
    offsets.push(offset);
    const users = offset === 0
      ? Array.from({ length: 20 }, (_, i) => ({ name: `follower${i}` }))
      : [{ name: "FOLLOWER19" }];
    return { data: { response: { total_users: 21, users } } };
  } } });
  const result = await service.snapshot("blog");
  assert.deepEqual(offsets, [0, 20, 0, 20]);
  assert.equal(result.count, 20);
  assert.equal(result.quality.duplicateCount, 1);
  assert.equal(result.quality.incomplete, true);
});

test("marks retry skipped if insufficient time remains and never hides upstream errors", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "snapshots-retry-limit-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let clock = 0;
  let calls = 0;
  const duplicatePage = { data: { response: { total_users: 2, users: [{ name: "a" }, { name: "a" }] } } };
  const limited = createFollowerSnapshots({ directory, env, now: () => clock, api: { get: async () => {
    calls++;
    clock = 14 * 60 * 1000 - 5000;
    return duplicatePage;
  } } });
  const result = await limited.snapshot("blog");
  assert.equal(calls, 1);
  assert.equal(result.quality.retrySkipped, true);
  assert.equal(result.quality.incomplete, true);
  const secondDirectory = path.join(directory, "other");
  calls = 0;
  const failing = createFollowerSnapshots({ directory: secondDirectory, env, delay: async () => {}, api: { get: async () => {
    if (++calls === 1) return duplicatePage;
    throw new Error("offline");
  } } });
  await assert.rejects(failing.snapshot("blog"), /offline/);
  assert.equal(fs.existsSync(secondDirectory), false);
});

test("compares older snapshots without quality metadata", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "snapshots-legacy-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const blogDirectory = path.join(directory, "blog");
  fs.mkdirSync(blogDirectory);
  fs.writeFileSync(path.join(blogDirectory, "first.json"), JSON.stringify({ blog: "blog", createdAt: "2026-01-01T00:00:00.000Z", followers: ["one"] }));
  fs.writeFileSync(path.join(blogDirectory, "second.json"), JSON.stringify({ blog: "blog", createdAt: "2026-02-01T00:00:00.000Z", followers: ["two"] }));
  const report = createFollowerSnapshots({ directory }).compare("blog");
  assert.equal(report.previousQuality, null);
  assert.equal(report.latestQuality, null);
  assert.deepEqual(report.newFollowers, ["two"]);
});

test("prevents simultaneous follower snapshots and releases lock after failure", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "snapshots-lock-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let resolve;
  const api = { get: () => new Promise((done) => { resolve = done; }) };
  const service = createFollowerSnapshots({ directory, api, env });
  const first = service.snapshot("blog");
  await assert.rejects(service.snapshot("blog"), /already running/);
  resolve({ data: { response: { total_users: 0, users: [] } } });
  await first;
  assert.equal(fs.readdirSync(path.join(directory, "blog")).length, 1);
});
