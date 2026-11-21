"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const paths = require("../config/dataPaths");
const { getLastReblog, parsePostUrl, postFromId } = require("./threadTracker");

const FRESH_MS = 60 * 60 * 1000;
const RETRY_MS = 15 * 60 * 1000;
const ERROR_RETRY_MS = 60 * 1000;
const REQUEST_GAP_MS = 1000;

class CacheStorageError extends Error {
  constructor(error) {
    super("Could not read or write the reblog cache. Check the server log.");
    this.cause = error;
  }
}

function validResult(result) {
  function validPost(post, allowMissingUrl) {
    if (!post || typeof post.blog !== "string" || !/^[a-z0-9][a-z0-9-]*$/i.test(post.blog) ||
        typeof post.timestamp !== "number" || !Number.isFinite(new Date(post.timestamp * 1000).getTime())) return false;
    if (post.url === null && allowMissingUrl) return true;
    if (typeof post.url !== "string") return false;
    try { return parsePostUrl(post.url).blog === post.blog.toLowerCase(); }
    catch { return false; }
  }
  return Boolean(result && ((result.lastReblog === null && validPost(result.savedPost, false)) ||
    (validPost(result.lastReblog, true) && result.savedPost === undefined)));
}

function retryTime(error, now) {
  const value = error.response?.headers?.["retry-after"];
  const seconds = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  const date = typeof value === "string" ? Date.parse(value) : NaN;
  const requested = Number.isFinite(seconds) && seconds >= 0 ? now + seconds * 1000 : date;
  return Number.isFinite(requested) && requested > now && requested <= 8640000000000000
    ? requested : now + RETRY_MS;
}

function createReblogCache({ file = path.join(paths.data, "reblog-cache.json"), now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  let state;
  let queue = Promise.resolve();
  let nextRequestAt = 0;
  const pending = new Map();
  const failures = new Map();

  function load() {
    if (state) return state;
    try {
      let data;
      try { data = JSON.parse(fs.readFileSync(file, "utf8")); }
      catch (error) {
        if (error.code === "ENOENT") return (state = { version: 1, rateLimitUntil: 0, entries: [] });
        throw error;
      }
      if (!data || data.version !== 1 || !Number.isFinite(data.rateLimitUntil) || data.rateLimitUntil < 0 ||
          !Array.isArray(data.entries)) throw new Error("Invalid reblog cache.");
      const keys = new Set();
      for (const entry of data.entries) {
        if (!entry || typeof entry.blog !== "string" || typeof entry.postId !== "string" ||
            !Number.isFinite(entry.checkedAt) || entry.checkedAt < 0 ||
            !Number.isFinite(new Date(entry.checkedAt).getTime()) || !validResult(entry.result)) {
          throw new Error("Invalid reblog cache entry.");
        }
        const post = postFromId(entry.blog, entry.postId);
        const key = `${post.blog}/${post.postId}`;
        if (post.blog !== entry.blog || post.postId !== entry.postId || keys.has(key)) {
          throw new Error("Invalid or duplicate reblog cache entry.");
        }
        keys.add(key);
      }
      return (state = data);
    } catch (error) {
      console.error("Could not load reblog cache:", error.message);
      throw new CacheStorageError(error);
    }
  }

  function save() {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx" });
      fs.renameSync(temporary, file);
    } catch (error) {
      console.error("Could not save reblog cache:", error.message);
      throw new CacheStorageError(error);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  function limitedError() {
    const error = new Error("Tumblr rate limit reached. Try again later.");
    error.response = { status: 429 };
    return error;
  }

  function request(api, ...args) {
    const work = queue.then(async () => {
      if (now() < load().rateLimitUntil) throw limitedError();
      const delay = nextRequestAt - now();
      if (delay > 0) await sleep(delay);
      if (now() < load().rateLimitUntil) throw limitedError();
      nextRequestAt = now() + REQUEST_GAP_MS;
      try {
        return await api.get(...args);
      } catch (error) {
        if (error.response?.status === 429) {
          state.rateLimitUntil = retryTime(error, now());
          save();
        }
        throw error;
      }
    });
    queue = work.then(() => undefined, () => undefined);
    return work;
  }

  async function get(thread, apiKey, api) {
    const post = postFromId(thread.blog, thread.postId);
    const key = `${post.blog}/${post.postId}`;
    const data = load();
    const cached = data.entries.find((entry) => entry.blog === post.blog && entry.postId === post.postId);
    if (cached && now() >= cached.checkedAt && now() - cached.checkedAt < FRESH_MS) {
      return { ...cached.result, cache: { checkedAt: cached.checkedAt, stale: false } };
    }
    const failure = failures.get(key);
    if (failure && now() < failure.until) {
      if (!cached) throw failure.error;
      return { ...cached.result, cache: { checkedAt: cached.checkedAt, stale: true, warning: failure.warning } };
    }
    failures.delete(key);
    if (pending.has(key)) return pending.get(key);
    const work = (async () => {
      let result;
      try {
        result = await getLastReblog(thread, apiKey, { get: (...args) => request(api, ...args) });
      } catch (error) {
        if (error instanceof CacheStorageError) throw error;
        const warning = error.response?.status === 429
          ? "Tumblr rate limit reached; showing the previous result."
          : "Could not update from Tumblr; showing the previous result.";
        if (error.response?.status !== 429) failures.set(key, { until: now() + ERROR_RETRY_MS, error, warning });
        if (!cached) throw error;
        console.error("Could not refresh cached reblog:", error.code || error.response?.status || error.name);
        return { ...cached.result, cache: { checkedAt: cached.checkedAt, stale: true, warning } };
      }
      if (!validResult(result)) throw new Error("Tumblr returned invalid reblog details.");
      const entry = { blog: post.blog, postId: post.postId, checkedAt: now(), result };
      const previous = cached && { ...cached };
      if (cached) Object.assign(cached, entry);
      else data.entries.push(entry);
      try { save(); }
      catch (error) {
        if (cached) Object.assign(cached, previous);
        else data.entries.pop();
        throw error;
      }
      return { ...result, cache: { checkedAt: entry.checkedAt, stale: false } };
    })();
    pending.set(key, work);
    try { return await work; }
    finally { pending.delete(key); }
  }

  return { get };
}

module.exports = { createReblogCache };
