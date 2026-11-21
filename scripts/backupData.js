"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const paths = require("../src/config/dataPaths");

function git(directory, args, options = {}) {
  const result = spawnSync("git", ["-c", "core.autocrlf=false", ...args], {
    cwd: directory,
    input: options.input,
    encoding: options.binary ? null : "utf8",
    maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_LITERAL_PATHSPECS: "1" },
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Git ${args[0]} failed. Check the backup repository, Git configuration and authentication.`);
  }
  return result.stdout;
}

function parseRemote(value) {
  const match = /^https:\/\/github\.com\/([a-z0-9_.-]+)\/([a-z0-9_.-]+?)(?:\.git)?$/i.exec(value);
  if (!match || [".", ".."].includes(match[1]) || [".", ".."].includes(match[2])) {
    throw new Error("Provide an HTTPS GitHub repository URL without credentials, query or fragment.");
  }
  return { owner: match[1], repo: match[2], url: `https://github.com/${match[1]}/${match[2]}.git` };
}

function sameRemote(left, right) {
  return parseRemote(left).url.toLowerCase() === right.url.toLowerCase();
}

async function verifyPrivateRemote(remote, directory, {
  getCredentials = () => git(directory, ["credential", "fill"], { input: "protocol=https\nhost=github.com\n\n" }),
  fetchRepo = fetch,
} = {}) {
  const credentials = getCredentials();
  const password = credentials.split(/\r?\n/).find((line) => line.startsWith("password="))?.slice(9);
  if (!password) throw new Error("Git Credential Manager did not provide a GitHub credential.");
  const response = await fetchRepo(`https://api.github.com/repos/${encodeURIComponent(remote.owner)}/${encodeURIComponent(remote.repo)}`, {
    headers: { Authorization: `Bearer ${password}`, Accept: "application/vnd.github+json", "User-Agent": "tumblr-data-backup" },
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!response.ok) {
    throw new Error(`GitHub privacy check failed (HTTP ${response.status}). Check repository access and authentication.`);
  }
  const repo = await response.json();
  if (repo.private !== true || repo.visibility !== "private" || typeof repo.full_name !== "string" ||
      repo.full_name.toLowerCase() !== `${remote.owner}/${remote.repo}`.toLowerCase()) {
    throw new Error("The GitHub repository is not private or did not match the requested repository.");
  }
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function readData(directory) {
  const files = new Map();
  function visit(current, relative = "") {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (/^\.env(?:\.|$)/i.test(entry.name) || entry.name.endsWith(".tmp")) continue;
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (/(?:credential|secret|token|private[-_]?key)/i.test(entry.name) || /\.(?:pem|key|p12|pfx)$/i.test(entry.name)) {
        throw new Error(`Refusing to back up a potentially sensitive file or directory: ${rel}`);
      }
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not supported in backup data: ${rel}`);
      if (entry.isDirectory()) visit(full, rel);
      else if (entry.isFile()) {
        const content = fs.readFileSync(full);
        if (content.length >= 100 * 1024 * 1024) throw new Error(`File exceeds GitHub's 100 MiB limit: ${rel}`);
        if (rel.toLowerCase().endsWith(".json")) {
          try { JSON.parse(content.toString("utf8")); }
          catch { throw new Error(`Invalid JSON in backup data: ${rel}`); }
        } else if (rel.toLowerCase().endsWith(".jsonl")) {
          try {
            for (const line of content.toString("utf8").split(/\r?\n/)) {
              if (line.trim()) JSON.parse(line);
            }
          } catch { throw new Error(`Invalid JSONL in backup data: ${rel}`); }
        }
        files.set(rel, content);
      } else {
        throw new Error(`Unsupported file type in backup data: ${rel}`);
      }
    }
  }
  visit(directory);
  return files;
}

function stableSnapshot(directory) {
  const first = readData(directory);
  const second = readData(directory);
  if (first.size !== second.size ||
      [...first].some(([name, content]) => !second.has(name) || !content.equals(second.get(name)))) {
    throw new Error("Data changed during backup. Try again when the tracker is idle.");
  }
  return second;
}

function safeTarget(root, relative) {
  const parts = relative.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) {
    throw new Error(`Invalid backup path: ${relative}`);
  }
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not supported in the backup repository: ${relative}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return current;
}

function syncData(directory, snapshot, tracked) {
  for (const name of snapshot.keys()) {
    const relative = `data/${name}`;
    const target = safeTarget(directory, relative);
    if (fs.existsSync(target) && (!tracked.has(relative) || !fs.lstatSync(target).isFile())) {
      throw new Error(`Backup target is not a tracked regular file: ${relative}`);
    }
  }
  for (const name of tracked) {
    if (!name.startsWith("data/")) throw new Error(`Unexpected tracked backup path: ${name}`);
    const target = safeTarget(directory, name);
    if (fs.existsSync(target) && !fs.lstatSync(target).isFile()) {
      throw new Error(`Backup target is not a regular file: ${name}`);
    }
  }
  for (const [name, content] of snapshot) {
    const target = safeTarget(directory, `data/${name}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    if (!fs.readFileSync(target).equals(content)) throw new Error(`Backup copy verification failed: ${name}`);
  }
  for (const name of tracked) {
    if (!snapshot.has(name.slice(5))) {
      const target = safeTarget(directory, name);
      if (fs.existsSync(target)) fs.unlinkSync(target);
    }
  }
}

async function backup({ backupDir, dataDir = paths.data, projectDir = paths.root, remoteUrl, now = new Date(), force = false,
  checkPrivate = verifyPrivateRemote, push = (dir, _remote, branch) => git(dir, ["push", "origin", `HEAD:refs/heads/${branch}`]) }) {
  const remote = parseRemote(remoteUrl);
  const directory = fs.realpathSync(backupDir);
  const source = fs.realpathSync(dataDir);
  const project = fs.realpathSync(projectDir);
  if (inside(project, directory) || inside(directory, project) || inside(source, directory) || inside(directory, source)) {
    throw new Error("The backup repository must be separate from the project and data directories.");
  }
  const gitRoot = fs.realpathSync(git(directory, ["rev-parse", "--show-toplevel"]).trim());
  if (gitRoot !== directory) throw new Error("Provide the root of the dedicated backup repository.");
  const gitDir = git(directory, ["rev-parse", "--absolute-git-dir"]).trim();
  const lockPath = path.join(gitDir, "tumblr-backup.lock");
  const statePath = path.join(gitDir, "tumblr-backup-state.json");
  let lock;
  try {
    lock = fs.openSync(lockPath, "wx");
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("A backup lock exists. Check for a running backup before removing it.");
    throw error;
  }
  try {
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const fetchUrls = git(directory, ["remote", "get-url", "--all", "origin"]).trim().split(/\r?\n/);
    const pushUrls = git(directory, ["remote", "get-url", "--all", "--push", "origin"]).trim().split(/\r?\n/);
    if (fetchUrls.length !== 1 || pushUrls.length !== 1 ||
        !sameRemote(fetchUrls[0], remote) || !sameRemote(pushUrls[0], remote)) {
      throw new Error("The backup repository's origin does not match the requested GitHub repository.");
    }
    if (git(directory, ["status", "--porcelain", "--untracked-files=all"]).trim()) {
      throw new Error("The backup repository has uncommitted changes. Resolve them before backing up.");
    }
    const branch = git(directory, ["symbolic-ref", "--short", "HEAD"]).trim();
    if (!branch) throw new Error("The backup repository must have a checked-out branch.");
    try {
      const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
      if (!state || typeof state.date !== "string" || typeof state.remote !== "string" || typeof state.branch !== "string") {
        throw new Error("Invalid backup state.");
      }
      if (!force && state.date === today && state.remote.toLowerCase() === remote.url.toLowerCase() && state.branch === branch) {
        return "A successful backup already ran today. Add --force to run another backup.";
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    git(directory, ["var", "GIT_AUTHOR_IDENT"]);
    git(directory, ["var", "GIT_COMMITTER_IDENT"]);
    await checkPrivate(remote, directory);
    const snapshot = stableSnapshot(source);
    const tracked = new Set(git(directory, ["ls-files", "-z", "--", "data"]).split("\0").filter(Boolean));
    syncData(directory, snapshot, tracked);
    const files = [...new Set([...tracked, ...[...snapshot.keys()].map((name) => `data/${name}`)])];
    if (files.length) {
      git(directory, ["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"], {
        input: Buffer.from(`${files.join("\0")}\0`),
      });
      for (const [name, content] of snapshot) {
        const staged = git(directory, ["show", `:data/${name}`], { binary: true });
        if (!staged.equals(content)) throw new Error(`Staged backup verification failed: ${name}`);
      }
    }
    const changes = git(directory, ["status", "--porcelain", "--untracked-files=all"]).trim();
    if (changes) git(directory, ["commit", "-m", `Data backup ${today}`]);
    await push(directory, remote, branch);
    const temporaryStatePath = `${statePath}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryStatePath, `${JSON.stringify({ date: today, remote: remote.url, branch })}\n`, { flag: "wx" });
      fs.renameSync(temporaryStatePath, statePath);
    } finally {
      if (fs.existsSync(temporaryStatePath)) fs.unlinkSync(temporaryStatePath);
    }
    return changes ? "Backup committed and pushed." : "Backup is up to date and pushed.";
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}

if (require.main === module) {
  const [backupDir, remoteUrl, option] = process.argv.slice(2);
  if (!backupDir || !remoteUrl || process.argv.length < 4 || process.argv.length > 5 ||
      backupDir.startsWith("--") || remoteUrl.startsWith("--") || (option !== undefined && option !== "--force")) {
    console.error("Usage: node scripts\\backupData.js <backup-repository-directory> <private-github-https-url> [--force]");
    process.exitCode = 1;
  } else {
    backup({ backupDir, remoteUrl, force: option === "--force" }).then((result) => console.log(result)).catch((error) => {
      console.error(`Backup failed: ${error.message}`);
      process.exitCode = 1;
    });
  }
}

module.exports = { backup, parseRemote, stableSnapshot, verifyPrivateRemote };
