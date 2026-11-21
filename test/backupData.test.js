"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { backup, parseRemote, stableSnapshot, verifyPrivateRemote } = require("../scripts/backupData");

function command(directory, ...args) {
  return execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-backup-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectDir = path.join(root, "project");
  const dataDir = path.join(projectDir, "data");
  const backupDir = path.join(root, "backup");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(backupDir);
  command(backupDir, "init", "-b", "main");
  command(backupDir, "config", "user.name", "Backup Test");
  command(backupDir, "config", "user.email", "backup-test@example.invalid");
  command(backupDir, "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(backupDir, "README.md"), "Dedicated backup\n");
  command(backupDir, "add", "README.md");
  command(backupDir, "commit", "-m", "Initial");
  const remoteUrl = "https://github.com/example/private-backup.git";
  command(backupDir, "remote", "add", "origin", remoteUrl);
  return { root, projectDir, dataDir, backupDir, remoteUrl };
}

test("refuses public or inaccessible repositories before a push", async () => {
  const remote = parseRemote("https://github.com/example/private-backup.git");
  const getCredentials = () => "username=dummy\npassword=dummy-value\n";
  let url;
  const fetchRepo = async (target, options) => {
    url = target;
    assert.equal(options.headers.Authorization, "Bearer dummy-value");
    return { ok: true, json: async () => ({ private: true, visibility: "private", full_name: "example/private-backup" }) };
  };
  await verifyPrivateRemote(remote, ".", { getCredentials, fetchRepo });
  assert.equal(url, "https://api.github.com/repos/example/private-backup");
  for (const result of [
    { ok: true, json: async () => ({ private: false, full_name: "example/private-backup" }) },
    { ok: true, json: async () => ({ private: true, visibility: "internal", full_name: "example/private-backup" }) },
    { ok: true, json: async () => ({ private: true, visibility: "private", full_name: "other/repo" }) },
    { ok: false, status: 404 },
  ]) {
    await assert.rejects(verifyPrivateRemote(remote, ".", { getCredentials, fetchRepo: async () => result }));
  }
  await assert.rejects(verifyPrivateRemote(remote, ".", { getCredentials: () => "", fetchRepo }), /credential/);
  for (const invalid of ["https://user:pass@github.com/example/repo", "https://github.com/example/repo?x=1", "https://example.com/example/repo", "git@github.com:example/repo.git"]) {
    assert.throws(() => parseRemote(invalid));
  }
});

test("backs up validated data, retries failed pushes and mirrors deletions in Git history", async (t) => {
  const f = fixture(t);
  command(f.backupDir, "config", "core.autocrlf", "true");
  fs.mkdirSync(path.join(f.dataDir, "threads"));
  fs.writeFileSync(path.join(f.dataDir, "threads", "tracked.json"), '{"thread":1}\r\n');
  fs.writeFileSync(path.join(f.dataDir, "threads", "literal[1].json"), '{"literal":true}\n');
  fs.writeFileSync(path.join(f.dataDir, ".env"), "excluded");
  fs.writeFileSync(path.join(f.dataDir, "threads", "pending.tmp"), "temporary");
  const dayOne = new Date(2026, 0, 1, 12);
  let pushes = 0;
  let checks = 0;
  const options = { ...f, now: dayOne, checkPrivate: async () => { checks++; }, push: async () => { pushes++; throw new Error("Offline"); } };
  await assert.rejects(backup(options), /Offline/);
  assert.equal(pushes, 1);
  assert.equal(command(f.backupDir, "-c", "core.autocrlf=false", "status", "--porcelain"), "");
  const firstCommit = command(f.backupDir, "rev-parse", "HEAD");
  const retry = { ...options, push: async () => { pushes++; } };
  assert.match(await backup(retry), /up to date and pushed/);
  assert.equal(command(f.backupDir, "rev-parse", "HEAD"), firstCommit);
  assert.equal(pushes, 2);
  assert.equal(checks, 2);
  assert.match(await backup(retry), /already ran today/);
  assert.equal(pushes, 2);
  assert.equal(fs.existsSync(path.join(f.backupDir, "data", ".env")), false);
  assert.equal(fs.existsSync(path.join(f.backupDir, "data", "threads", "pending.tmp")), false);
  assert.equal(command(f.backupDir, "show", "HEAD:data/threads/tracked.json"), '{"thread":1}');
  assert.equal(command(f.backupDir, "show", "HEAD:data/threads/literal[1].json"), '{"literal":true}');
  fs.unlinkSync(path.join(f.dataDir, "threads", "tracked.json"));
  fs.writeFileSync(path.join(f.dataDir, "threads", "new.json"), '{"thread":2}\n');
  assert.match(await backup({ ...retry, now: new Date(2026, 0, 2, 12) }), /committed and pushed/);
  assert.equal(fs.existsSync(path.join(f.backupDir, "data", "threads", "tracked.json")), false);
  assert.equal(command(f.backupDir, "show", `${firstCommit}:data/threads/tracked.json`), '{"thread":1}');
  assert.equal(command(f.backupDir, "show", "HEAD:data/threads/new.json"), '{"thread":2}');
});

test("refuses unsafe destinations, dirty repositories and invalid data without pushing", async (t) => {
  const f = fixture(t);
  let pushes = 0;
  const options = { ...f, now: new Date(2026, 0, 1), checkPrivate: async () => {}, push: async () => { pushes++; } };
  await assert.rejects(backup({ ...options, backupDir: f.projectDir }), /separate/);
  await assert.rejects(backup({ ...options, remoteUrl: "https://github.com/example/wrong.git" }), /origin/);
  await assert.rejects(backup({ ...options, checkPrivate: async () => { throw new Error("Not private"); } }), /Not private/);
  assert.equal(fs.existsSync(path.join(f.backupDir, "data")), false);
  fs.writeFileSync(path.join(f.backupDir, "unrelated.txt"), "keep");
  await assert.rejects(backup(options), /uncommitted changes/);
  assert.equal(fs.readFileSync(path.join(f.backupDir, "unrelated.txt"), "utf8"), "keep");
  fs.unlinkSync(path.join(f.backupDir, "unrelated.txt"));
  fs.writeFileSync(path.join(f.dataDir, "broken.json"), "{");
  await assert.rejects(backup(options), /Invalid JSON/);
  assert.equal(pushes, 0);
  assert.equal(command(f.backupDir, "status", "--porcelain"), "");
  fs.unlinkSync(path.join(f.dataDir, "broken.json"));
  fs.writeFileSync(path.join(f.dataDir, "credentials.json"), "{}");
  assert.throws(() => stableSnapshot(f.dataDir), /potentially sensitive/);
});

test("does not overwrite ignored files or follow links in the backup checkout", async (t) => {
  const f = fixture(t);
  const options = { ...f, now: new Date(2026, 0, 1), checkPrivate: async () => {}, push: async () => {} };
  fs.writeFileSync(path.join(f.dataDir, "item.json"), '{"new":true}');
  fs.mkdirSync(path.join(f.backupDir, "data"));
  fs.writeFileSync(path.join(f.backupDir, ".git", "info", "exclude"), "data/item.json\n");
  fs.writeFileSync(path.join(f.backupDir, "data", "item.json"), "keep");
  await assert.rejects(backup(options), /not a tracked regular file/);
  assert.equal(fs.readFileSync(path.join(f.backupDir, "data", "item.json"), "utf8"), "keep");
  fs.unlinkSync(path.join(f.backupDir, "data", "item.json"));
  fs.rmdirSync(path.join(f.backupDir, "data"));
  fs.symlinkSync(f.dataDir, path.join(f.backupDir, "data"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(backup(options), /Symbolic links/);
  assert.equal(fs.readFileSync(path.join(f.dataDir, "item.json"), "utf8"), '{"new":true}');
});

test("a pushed backup can be restored from a separate clone", async (t) => {
  const f = fixture(t);
  const bare = path.join(f.root, "remote.git");
  command(f.root, "init", "--bare", bare);
  command(f.backupDir, "config", "core.autocrlf", "true");
  fs.writeFileSync(path.join(f.dataDir, "thread.json"), '{"saved":true}\n');
  fs.writeFileSync(path.join(f.dataDir, "windows.json"), '{"saved":true}\r\n');
  await backup({
    ...f,
    now: new Date(2026, 0, 1),
    checkPrivate: async () => {},
    push: async (directory, _remote, branch) => command(directory, "push", bare, `HEAD:refs/heads/${branch}`),
  });
  const restored = path.join(f.root, "restored");
  command(f.root, "clone", "--config", "core.autocrlf=false", "--branch", "main", bare, restored);
  assert.equal(fs.readFileSync(path.join(restored, "data", "thread.json"), "utf8"), '{"saved":true}\n');
  assert.equal(fs.readFileSync(path.join(restored, "data", "windows.json"), "utf8"), '{"saved":true}\r\n');
});
