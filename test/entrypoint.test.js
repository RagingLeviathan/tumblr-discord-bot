"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("root entry point loads the application", () => {
  const calls = [];
  const root = path.join(__dirname, "..");
  vm.runInNewContext(fs.readFileSync(path.join(root, "index.js"), "utf8"), {
    require: (name) => calls.push(name),
  });
  assert.deepEqual(calls, ["./src/index"]);
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.main, "index.js");
  assert.equal(packageJson.scripts.start, "node index.js");
});
