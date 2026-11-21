"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { migrateData } = require("../src/config/migrateData");
const { createBlogThreadStore } = require("../src/threads/threadTracker");

test("migrates existing data and keeps thread collections usable", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bot-data-migration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const thread = '[{"title":"Thread","url":"https://www.tumblr.com/root/123"}]';
  fs.writeFileSync(path.join(root, "tracked_threads.json"), thread);
  fs.writeFileSync(path.join(root, "tracked_threads_other.json"), "[]");
  fs.writeFileSync(path.join(root, "new_followers.json"), '["person"]');
  fs.writeFileSync(path.join(root, "followers-old.json"), "[]");
  fs.mkdirSync(path.join(root, "follower-snapshots", "blog"), { recursive: true });
  fs.writeFileSync(path.join(root, "follower-snapshots", "blog", "snapshot.json"), "snapshot");
  fs.mkdirSync(path.join(root, "slash-audit"));
  fs.writeFileSync(path.join(root, "slash-audit", "commands.jsonl"), "audit");
  migrateData(root);
  const data = path.join(root, "data");
  assert.equal(fs.readFileSync(path.join(data, "threads", "tracked_threads.json"), "utf8"), thread);
  assert.equal(fs.readFileSync(path.join(data, "legacy", "new_followers.json"), "utf8"), '["person"]');
  assert.equal(fs.readFileSync(path.join(data, "legacy", "followers-old.json"), "utf8"), "[]");
  assert.equal(fs.readFileSync(path.join(data, "follower-snapshots", "blog", "snapshot.json"), "utf8"), "snapshot");
  assert.equal(fs.readFileSync(path.join(data, "slash-audit", "commands.jsonl"), "utf8"), "audit");
  assert.equal(fs.existsSync(path.join(root, "tracked_threads.json")), false);
  const store = createBlogThreadStore({ directory: path.join(data, "threads"), getBlog: () => "blog" });
  assert.equal(store.list()[0].title, "Thread");
  assert.deepEqual(store.forBlog("other").list(), []);
  migrateData(root);
});

test("does not overwrite or delete conflicting data and can resume", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bot-data-conflict-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "tracked_threads.json");
  const target = path.join(root, "data", "threads", "tracked_threads.json");
  fs.writeFileSync(source, "source");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "different");
  assert.throws(() => migrateData(root), /migration conflict/i);
  assert.equal(fs.readFileSync(source, "utf8"), "source");
  assert.equal(fs.readFileSync(target, "utf8"), "different");
  fs.writeFileSync(target, "source");
  migrateData(root);
  assert.equal(fs.existsSync(source), false);
  assert.equal(fs.readFileSync(target, "utf8"), "source");
});

test("the relocated comparison script accepts input and output paths", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bot-script-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const latest = path.join(root, "latest.json");
  const previous = path.join(root, "previous.json");
  const output = path.join(root, "report.json");
  fs.writeFileSync(latest, JSON.stringify([{ name: "new" }]));
  fs.writeFileSync(previous, JSON.stringify([{ name: "old" }]));
  const script = path.join(__dirname, "..", "scripts", "missingNames.js");
  const result = spawnSync(process.execPath, [script, latest, previous, output], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(report.summary.newFollowersCount, 1);
  assert.equal(report.summary.missingFromLatestCount, 1);
});
