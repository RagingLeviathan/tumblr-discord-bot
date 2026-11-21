"use strict";

const fs = require("fs");
const path = require("path");
const paths = require("../config/dataPaths");

function createSlashAudit(directory = paths.audit) {
  const file = path.join(directory, "commands.jsonl");
  return {
    write(entry) {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fs.appendFileSync(file, `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`, { mode: 0o600 });
    },
  };
}

module.exports = { createSlashAudit };
