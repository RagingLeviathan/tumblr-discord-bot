"use strict";

const fs = require("fs");
const path = require("path");
const paths = require("./dataPaths");

function migrateData(root = paths.root) {
  const data = path.join(root, "data");
  const directories = {
    threads: path.join(data, "threads"),
    snapshots: path.join(data, "follower-snapshots"),
    audit: path.join(data, "slash-audit"),
    legacy: path.join(data, "legacy"),
  };
  for (const directory of Object.values(directories)) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  function moveFile(source, target) {
    try {
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    if (!fs.readFileSync(source).equals(fs.readFileSync(target))) {
      throw new Error(`Data migration conflict: ${source} and ${target} differ. Neither file was removed.`);
    }
    fs.unlinkSync(source);
    console.log(`Migrated data: ${source} -> ${target}`);
  }

  function moveDirectory(source, target) {
    if (!fs.existsSync(source)) return;
    if (!fs.lstatSync(source).isDirectory()) throw new Error(`Expected a directory: ${source}`);
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const from = path.join(source, entry.name);
      const to = path.join(target, entry.name);
      if (entry.isDirectory()) moveDirectory(from, to);
      else if (entry.isFile()) moveFile(from, to);
      else throw new Error(`Cannot migrate non-regular file: ${from}`);
    }
    fs.rmdirSync(source);
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    let target;
    if (entry.name === "tracked_threads.json" || entry.name === "tracked_threads.migration.json" ||
        /^tracked_threads_[a-z0-9][a-z0-9-]*\.json$/i.test(entry.name)) {
      target = directories.threads;
    } else if (/^followers.*\.json$/i.test(entry.name) ||
               entry.name === "missing_names.json" || entry.name === "new_followers.json") {
      target = directories.legacy;
    }
    if (target) moveFile(path.join(root, entry.name), path.join(target, entry.name));
  }
  moveDirectory(path.join(root, "follower-snapshots"), directories.snapshots);
  moveDirectory(path.join(root, "slash-audit"), directories.audit);
}

module.exports = { migrateData };
