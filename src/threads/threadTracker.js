"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getThreadBlog } = require("../config/blogConfig");
const paths = require("../config/dataPaths");
const { BLOG_PATTERN, ValidationError, postFromId, parsePostUrl } = require("../../public/threads/postReference");

const DEFAULT_FILE = path.join(paths.threads, "tracked_threads.json");

class DuplicateThreadError extends ValidationError {
  constructor(thread) {
    super("This post is already tracked.");
    this.thread = thread;
  }
}

function validateTitle(title) {
  if (typeof title !== "string" || !title.trim() || title.trim().length > 200) {
    throw new ValidationError("Enter a thread title of 1 to 200 characters.");
  }
  return title.trim();
}

async function verifyPost(thread, apiKey, axios) {
  if (!apiKey) throw new Error("Set CONSUMER_KEY in .env to verify Tumblr posts.");
  const result = await axios.get(
    `https://api.tumblr.com/v2/blog/${encodeURIComponent(thread.blog)}.tumblr.com/posts`,
    { params: { id: thread.postId, api_key: apiKey }, timeout: 10000 }
  );
  const response = result.data && result.data.response;
  if (!response || !Array.isArray(response.posts)) {
    throw new Error("Tumblr returned an unexpected post response.");
  }
  if (response.posts.length === 0) {
    throw new ValidationError("Post not found or inaccessible on this blog. Check the blog name and post ID.");
  }
  if (response.posts.length !== 1 || response.posts[0].id_string !== thread.postId ||
      typeof response.posts[0].blog_name !== "string" ||
      response.posts[0].blog_name.toLowerCase() !== thread.blog) {
    throw new Error("Tumblr returned an unexpected post response.");
  }
  return response.posts[0];
}

function trailPostId(value) {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

function extractTrail(post) {
  if (post.trail !== undefined && !Array.isArray(post.trail)) {
    throw new Error("Tumblr returned an invalid reblog trail.");
  }
  const entries = (post.trail || []).map((item) => {
    if (!item || typeof item !== "object") throw new Error("Tumblr returned an invalid trail item.");
    const rawBlog = item.blog && item.blog.name;
    const blog = typeof rawBlog === "string" && BLOG_PATTERN.test(rawBlog.toLowerCase()) ? rawBlog : null;
    const postId = item.post ? trailPostId(item.post.id_string || item.post.id) : null;
    return {
      blog,
      blogUuid: item.blog && typeof item.blog.uuid === "string" ? item.blog.uuid : null,
      brokenBlog: typeof item.broken_blog_name === "string" ? item.broken_blog_name : null,
      postId,
      url: blog && postId ? postFromId(blog, postId).url : null,
    };
  });
  return { entries, parentPostId: trailPostId(post.parent_post_id) };
}

async function getTrail(thread, { api, apiKey, accessToken, authenticated = false }) {
  if (authenticated) {
    if (!accessToken) throw new ValidationError("Authorize Tumblr first using the link in the trail panel.");
    const response = await api.get(
      `https://api.tumblr.com/v2/blog/${encodeURIComponent(thread.blog)}.tumblr.com/posts/${encodeURIComponent(thread.postId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, params: { post_format: "npf" }, timeout: 10000 }
    );
    const post = response.data && response.data.response;
    if (!post || typeof post !== "object" || Array.isArray(post)) throw new Error("Tumblr returned an unexpected authenticated post response.");
    if (trailPostId(post.id_string || post.id) !== thread.postId) throw new Error("Tumblr returned a different post.");
    return extractTrail(post);
  }
  if (!apiKey) throw new ValidationError("Set CONSUMER_KEY in .env to fetch the trail.");
  const response = await api.get(
    `https://api.tumblr.com/v2/blog/${encodeURIComponent(thread.blog)}.tumblr.com/posts`,
    { params: { id: thread.postId, api_key: apiKey, npf: true, reblog_info: true }, timeout: 10000 }
  );
  const posts = response.data && response.data.response && response.data.response.posts;
  if (!Array.isArray(posts) || posts.length !== 1 || posts[0].id_string !== thread.postId ||
      typeof posts[0].blog_name !== "string" || posts[0].blog_name.toLowerCase() !== thread.blog) {
    throw new Error("Tumblr returned an unexpected post response.");
  }
  return extractTrail(posts[0]);
}

function writingPartner(title) {
  const match = /^w\/\s+(.+?)\s+\|\s+(.+)$/i.exec(title);
  return match ? match[1].trim() : null;
}

function partnerKey(title) {
  return writingPartner(title)?.toLowerCase() || null;
}

function nextPartnerNumber(title, threads) {
  const key = partnerKey(title);
  if (!key) return undefined;
  const max = threads.reduce((number, thread) =>
    partnerKey(thread.title) === key ? Math.max(number, thread.partnerNumber || 0) : number, 0);
  if (max >= Number.MAX_SAFE_INTEGER) throw new Error("No more writing partner numbers are available.");
  return max + 1;
}

function createThreadStore(file = DEFAULT_FILE, { allowMissing = false, persistPartnerNumbers = true } = {}) {
  function read() {
    let contents;
    try {
      contents = fs.readFileSync(file, "utf8");
    } catch (error) {
      if (allowMissing && error.code === "ENOENT") return [];
      throw error;
    }
    const data = JSON.parse(contents);
    if (!Array.isArray(data)) {
      throw new Error("Tracked threads file must contain an array.");
    }
    const threads = data.map((thread) => {
      if (!thread || typeof thread.title !== "string" || !thread.title.trim() || typeof thread.url !== "string") {
        throw new Error("Tracked threads file contains an invalid entry.");
      }
      if (thread.auId !== undefined && (typeof thread.auId !== "string" || !thread.auId)) {
        throw new Error("Tracked threads file contains an invalid AU ID.");
      }
      for (const key of ["completed", "favourite"]) {
        if (thread[key] !== undefined && typeof thread[key] !== "boolean") {
          throw new Error(`Tracked threads file contains an invalid ${key} flag.`);
        }
      }
      const partner = writingPartner(thread.title);
      if (thread.partnerNumber !== undefined &&
          (!partner || !Number.isSafeInteger(thread.partnerNumber) || thread.partnerNumber < 1)) {
        throw new Error("Tracked threads file contains an invalid writing partner number.");
      }
      try {
        return {
          title: thread.title, ...parsePostUrl(thread.url),
          ...(partner ? { partner } : {}),
          ...(thread.partnerNumber !== undefined ? { partnerNumber: thread.partnerNumber } : {}),
          ...(thread.auId !== undefined ? { auId: thread.auId } : {}),
          ...(thread.completed ? { completed: true } : {}),
          ...(thread.favourite ? { favourite: true } : {}),
        };
      } catch (error) {
        throw new Error(`Tracked threads file contains an invalid URL: ${error.message}`);
      }
    });
    const numbers = new Map();
    const maxNumbers = new Map();
    for (const thread of threads) {
      if (thread.partnerNumber === undefined) continue;
      const key = partnerKey(thread.title);
      if (!numbers.has(key)) numbers.set(key, new Set());
      if (numbers.get(key).has(thread.partnerNumber)) {
        throw new Error("Tracked threads file contains duplicate writing partner numbers.");
      }
      numbers.get(key).add(thread.partnerNumber);
      maxNumbers.set(key, Math.max(maxNumbers.get(key) || 0, thread.partnerNumber));
    }
    let changed = false;
    for (const [index, thread] of threads.entries()) {
      if (!thread.partner || thread.partnerNumber !== undefined) continue;
      const key = partnerKey(thread.title);
      const max = maxNumbers.get(key) || 0;
      if (max >= Number.MAX_SAFE_INTEGER) throw new Error("No more writing partner numbers are available.");
      thread.partnerNumber = max + 1;
      maxNumbers.set(key, thread.partnerNumber);
      data[index].partnerNumber = thread.partnerNumber;
      changed = true;
    }
    if (changed && persistPartnerNumbers) writeRaw(data);
    return threads;
  }

  function writeRaw(data) {
    const temporaryFile = `${file}.${crypto.randomBytes(8).toString("hex")}.tmp`;
    try {
      fs.writeFileSync(temporaryFile, `${JSON.stringify(data, null, 2)}\n`, { flag: "wx" });
      fs.renameSync(temporaryFile, file);
    } finally {
      if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
    }
  }

  function write(threads) {
    writeRaw(threads.map(({ title, url, auId, completed, favourite, partnerNumber }) => ({
      title, url, ...(auId ? { auId } : {}),
      ...(completed ? { completed: true } : {}), ...(favourite ? { favourite: true } : {}),
      ...(partnerNumber !== undefined ? { partnerNumber } : {}),
    })));
  }

  return {
    list: read,
    add(title, url, auId) {
      const thread = { title: validateTitle(title), ...parsePostUrl(url) };
      if (auId) thread.auId = auId;
      const threads = read();
      const duplicate = threads.find((item) => item.blog === thread.blog && item.postId === thread.postId);
      if (duplicate) throw new DuplicateThreadError(duplicate);
      const partner = writingPartner(thread.title);
      if (partner) {
        thread.partner = partner;
        thread.partnerNumber = nextPartnerNumber(thread.title, threads);
      }
      threads.push(thread);
      write(threads);
      return thread;
    },
    update(blog, postId, title, url, auId, completed) {
      if (completed !== undefined && typeof completed !== "boolean") {
        throw new ValidationError("Provide completed as a boolean value.");
      }
      const thread = { title: validateTitle(title), ...parsePostUrl(url) };
      const threads = read();
      const index = threads.findIndex((item) => item.blog === blog && item.postId === postId);
      if (index === -1) return null;
      if (auId === undefined) auId = threads[index].auId;
      if (auId) thread.auId = auId;
      if (completed === undefined ? threads[index].completed : completed) thread.completed = true;
      if (threads[index].favourite) thread.favourite = true;
      const duplicate = threads.find((item, i) => i !== index && item.blog === thread.blog && item.postId === thread.postId);
      if (duplicate) throw new DuplicateThreadError(duplicate);
      const partner = writingPartner(thread.title);
      if (partner) {
        thread.partner = partner;
        thread.partnerNumber = partnerKey(thread.title) === partnerKey(threads[index].title)
          ? threads[index].partnerNumber : nextPartnerNumber(thread.title, threads);
      }
      threads[index] = thread;
      write(threads);
      return thread;
    },
    setFlags(blog, postId, flags) {
      if (!flags || typeof flags !== "object" || Array.isArray(flags) ||
          !Object.keys(flags).length || Object.keys(flags).some((key) =>
            !["completed", "favourite"].includes(key) || typeof flags[key] !== "boolean")) {
        throw new ValidationError("Provide completed and/or favourite as boolean values.");
      }
      const threads = read();
      const thread = threads.find((item) => item.blog === blog && item.postId === postId);
      if (!thread) return null;
      for (const [key, value] of Object.entries(flags)) {
        if (value) thread[key] = true;
        else delete thread[key];
      }
      write(threads);
      return thread;
    },
    remove(blog, postId) {
      const threads = read();
      const filtered = threads.filter((thread) => thread.blog !== blog || thread.postId !== postId);
      if (filtered.length === threads.length) return false;
      write(filtered);
      return true;
    },
  };
}

function normalizeCollectionBlog(blog) {
  if (typeof blog !== "string" || !BLOG_PATTERN.test(blog.trim().toLowerCase())) {
    throw new Error("BLOG_NAME must be a valid Tumblr blog name for thread storage.");
  }
  return blog.trim().toLowerCase();
}

function createBlogThreadStore({ directory = paths.threads, getBlog = getThreadBlog } = {}) {
  const legacyFile = path.join(directory, "tracked_threads.json");
  const markerFile = path.join(directory, "tracked_threads.migration.json");

  function forBlog(value) {
    const blog = normalizeCollectionBlog(value);
    const file = path.join(directory, `tracked_threads_${blog}.json`);
    if (fs.existsSync(legacyFile)) {
      let marker;
      try {
        marker = JSON.parse(fs.readFileSync(markerFile, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        createThreadStore(legacyFile, { persistPartnerNumbers: false }).list();
        try {
          fs.writeFileSync(markerFile, `${JSON.stringify({ blog, complete: false })}\n`, { flag: "wx" });
        } catch (writeError) {
          if (writeError.code !== "EEXIST") throw writeError;
        }
        marker = JSON.parse(fs.readFileSync(markerFile, "utf8"));
      }
      if (!marker || typeof marker.blog !== "string" || normalizeCollectionBlog(marker.blog) !== marker.blog ||
          typeof marker.complete !== "boolean") {
        throw new Error("Invalid tracked threads migration marker.");
      }
      if (marker.blog === blog && !marker.complete) {
        if (!fs.existsSync(file)) {
          const temporaryFile = `${file}.${crypto.randomBytes(8).toString("hex")}.tmp`;
          try {
            fs.copyFileSync(legacyFile, temporaryFile, fs.constants.COPYFILE_EXCL);
            fs.linkSync(temporaryFile, file);
          } catch (error) {
            if (error.code !== "EEXIST") throw error;
          } finally {
            if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
          }
        }
        const temporaryFile = `${markerFile}.${crypto.randomBytes(8).toString("hex")}.tmp`;
        try {
          fs.writeFileSync(temporaryFile, `${JSON.stringify({ blog, complete: true })}\n`, { flag: "wx" });
          fs.renameSync(temporaryFile, markerFile);
        } finally {
          if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
        }
      }
    }
    return createThreadStore(file, { allowMissing: true });
  }

  return {
    forBlog,
    list: () => forBlog(getBlog()).list(),
    add: (...args) => forBlog(getBlog()).add(...args),
    update: (...args) => forBlog(getBlog()).update(...args),
    setFlags: (...args) => forBlog(getBlog()).setFlags(...args),
    remove: (...args) => forBlog(getBlog()).remove(...args),
  };
}

async function getLastReblog(thread, apiKey, axios) {
  if (!apiKey) throw new Error("Set CONSUMER_KEY in .env to fetch Tumblr notes.");
  const result = await axios.get(
    `https://api.tumblr.com/v2/blog/${encodeURIComponent(thread.blog)}.tumblr.com/notes`,
    {
      params: { id: thread.postId, mode: "reblogs_with_tags", api_key: apiKey },
      timeout: 10000,
    }
  );
  const response = result.data && result.data.response;
  if (!response || !Array.isArray(response.notes)) {
    throw new Error("Tumblr returned an unexpected notes response.");
  }
  const note = response.notes.find((item) => item.type === "reblog");
  if (!note) {
    if (response._links && response._links.next) {
      throw new Error("Tumblr returned an incomplete page of reblogs. Try refreshing.");
    }
    const post = await verifyPost(thread, apiKey, axios);
    if (typeof post.timestamp !== "number" || !Number.isFinite(post.timestamp) ||
        !Number.isFinite(new Date(post.timestamp * 1000).getTime())) {
      throw new Error("Tumblr returned an invalid saved post date.");
    }
    return {
      lastReblog: null,
      savedPost: { blog: post.blog_name, timestamp: post.timestamp, url: thread.url },
    };
  }
  if (typeof note.blog_name !== "string" || !BLOG_PATTERN.test(note.blog_name.toLowerCase()) ||
      typeof note.timestamp !== "number" || !Number.isFinite(note.timestamp)) {
    throw new Error("Tumblr returned an incomplete reblog.");
  }
  const postId = typeof note.post_id === "string" && /^\d+$/.test(note.post_id)
    ? note.post_id
    : Number.isSafeInteger(note.post_id) && note.post_id >= 0 ? String(note.post_id) : null;
  return {
    lastReblog: {
      blog: note.blog_name,
      timestamp: note.timestamp,
      url: postId ? `https://www.tumblr.com/${note.blog_name.toLowerCase()}/${postId}` : null,
    },
  };
}

module.exports = { createThreadStore, createBlogThreadStore, normalizeCollectionBlog, getLastReblog, getTrail, parsePostUrl, postFromId, validateTitle, verifyPost, ValidationError, DuplicateThreadError };
