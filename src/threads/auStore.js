"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const paths = require("../config/dataPaths");
const { ValidationError, normalizeCollectionBlog } = require("./threadTracker");

function validateShortName(value) {
  if (typeof value !== "string" || value.trim().length > 50) {
    throw new ValidationError("Enter a short name of 50 characters or fewer.");
  }
  return value.trim();
}

function validateVerseUrl(value) {
  if (typeof value !== "string" || value.trim().length > 2048) {
    throw new ValidationError("Enter a verse info URL of 2048 characters or fewer.");
  }
  const trimmed = value.trim();
  if (!trimmed) return "";
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ValidationError("Enter a valid HTTP or HTTPS verse info URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new ValidationError("Enter a valid HTTP or HTTPS verse info URL without credentials.");
  }
  return trimmed;
}

function createAuStore(blog, directory = paths.threads) {
  const file = path.join(directory, `aus_${normalizeCollectionBlog(blog)}.json`);

  function list() {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    if (!Array.isArray(data) || data.some((au) => !au || typeof au.id !== "string" ||
      !au.id || typeof au.name !== "string" || !au.name.trim() || au.name.trim().length > 100) ||
      new Set(data.map((au) => au.id)).size !== data.length ||
      new Set(data.map((au) => au.name.trim().toLowerCase())).size !== data.length) {
      throw new Error("AU file contains invalid or duplicate entries.");
    }
    for (const au of data) {
      try {
        if (au.shortName !== undefined) validateShortName(au.shortName);
        if (au.verseUrl !== undefined) validateVerseUrl(au.verseUrl);
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        throw new Error(`AU file contains invalid details: ${error.message}`);
      }
    }
    return data;
  }

  function write(aus) {
    const temporaryFile = `${file}.${crypto.randomBytes(8).toString("hex")}.tmp`;
    try {
      fs.writeFileSync(temporaryFile, `${JSON.stringify(aus, null, 2)}\n`, { flag: "wx" });
      fs.renameSync(temporaryFile, file);
    } finally {
      if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
    }
  }

  function saveAu(name, shortName, verseUrl, id) {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 100) {
      throw new ValidationError("Enter an AU name of 1 to 100 characters.");
    }
    name = name.trim();
    const aus = list();
    const existing = id && aus.find((au) => au.id === id);
    if (id && !existing) return null;
    if (aus.some((au) => au.id !== id && au.name.trim().toLowerCase() === name.toLowerCase())) {
      throw new ValidationError("An AU with that name already exists.");
    }
    if (shortName !== undefined) shortName = validateShortName(shortName);
    if (verseUrl !== undefined) verseUrl = validateVerseUrl(verseUrl);
    const au = existing || { id: crypto.randomUUID() };
    au.name = name;
    if (shortName !== undefined) {
      if (shortName) au.shortName = shortName;
      else delete au.shortName;
    }
    if (verseUrl !== undefined) {
      if (verseUrl) au.verseUrl = verseUrl;
      else delete au.verseUrl;
    }
    if (!existing) aus.push(au);
    write(aus);
    return au;
  }

  return {
    list,
    add: (name, shortName, verseUrl) => saveAu(name, shortName, verseUrl),
    update: (id, name, shortName, verseUrl) => saveAu(name, shortName, verseUrl, id),
    remove(id) {
      const aus = list();
      const filtered = aus.filter((au) => au.id !== id);
      if (filtered.length === aus.length) return false;
      write(filtered);
      return true;
    },
  };
}

module.exports = { createAuStore };
