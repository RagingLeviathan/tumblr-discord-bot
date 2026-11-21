"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const paths = require("../config/dataPaths");
const { ValidationError, normalizeCollectionBlog, parsePostUrl } = require("./threadTracker");

function validateAsk(url, note = "") {
  if (typeof url !== "string" || url.length > 2048) {
    throw new ValidationError("Enter a Tumblr post URL of 2048 characters or fewer.");
  }
  if (typeof note !== "string" || note.trim().length > 500) {
    throw new ValidationError("Enter a note of 500 characters or fewer.");
  }
  return { ...parsePostUrl(url.trim()), note: note.trim() };
}

function createAskStore(blog, directory = paths.threads) {
  const file = path.join(directory, `asks_${normalizeCollectionBlog(blog)}.json`);

  function list() {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    if (!Array.isArray(data)) throw new Error("Ask file must contain an array.");
    const seenIds = new Set();
    const seenPosts = new Set();
    return data.map((item) => {
      if (!item || typeof item.id !== "string" || !item.id || typeof item.note !== "string") {
        throw new Error("Ask file contains an invalid entry.");
      }
      let ask;
      try {
        ask = validateAsk(item.url, item.note);
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        throw new Error(`Ask file contains invalid details: ${error.message}`);
      }
      const key = `${ask.blog}/${ask.postId}`;
      if (seenIds.has(item.id) || seenPosts.has(key)) throw new Error("Ask file contains duplicate entries.");
      seenIds.add(item.id);
      seenPosts.add(key);
      return { id: item.id, ...ask };
    });
  }

  function write(asks) {
    const temporaryFile = `${file}.${crypto.randomBytes(8).toString("hex")}.tmp`;
    try {
      fs.writeFileSync(temporaryFile, `${JSON.stringify(asks, null, 2)}\n`, { flag: "wx" });
      fs.renameSync(temporaryFile, file);
    } finally {
      if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
    }
  }

  return {
    list,
    add(url, note) {
      const details = validateAsk(url, note);
      const asks = list();
      if (asks.some((ask) => ask.blog === details.blog && ask.postId === details.postId)) {
        throw new ValidationError("This ask is already saved.");
      }
      const ask = { id: crypto.randomUUID(), ...details };
      asks.push(ask);
      write(asks);
      return ask;
    },
    remove(id) {
      const asks = list();
      const remaining = asks.filter((ask) => ask.id !== id);
      if (remaining.length === asks.length) return false;
      write(remaining);
      return true;
    },
  };
}

module.exports = { createAskStore };
