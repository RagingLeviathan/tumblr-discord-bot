"use strict";

const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const data = path.join(root, "data");

module.exports = {
  root,
  data,
  threads: path.join(data, "threads"),
  snapshots: path.join(data, "follower-snapshots"),
  audit: path.join(data, "slash-audit"),
  legacy: path.join(data, "legacy"),
};
