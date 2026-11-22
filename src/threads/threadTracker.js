"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getThreadBlog } = require("../config/blogConfig");
const paths = require("../config/dataPaths");
const { BLOG_PATTERN, ValidationError, postFromId, parsePostUrl } = require("../../public/threads/postReference");

const DEFAULT_FILE = path.join(paths.threads, "tracked_threads.json");
const BLOG_UUID_PATTERN = /^t:[A-Za-z0-9_-]+$/;

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

async function verifyPostDetails(thread, apiKey, axios) {
  if (!apiKey) throw new Error("Set CONSUMER_KEY in .env to verify Tumblr posts.");
  const identifier = thread.blogUuid ? encodeURIComponent(thread.blogUuid) : `${encodeURIComponent(thread.blog)}.tumblr.com`;
  const result = await axios.get(
    `https://api.tumblr.com/v2/blog/${identifier}/posts`,
    { params: { id: thread.postId, api_key: apiKey }, timeout: 10000 }
  );
  const response = result.data && result.data.response;
  if (!response || !Array.isArray(response.posts)) {
    throw new Error("Tumblr returned an unexpected post response.");
  }
  if (response.posts.length === 0) {
    throw new ValidationError("Tumblr could not find or access this post. Check the publishing blog and post ID; restricted posts may not be available through the public API.");
  }
  if (response.posts.length !== 1 || response.posts[0].id_string !== thread.postId ||
      typeof response.posts[0].blog_name !== "string" ||
      !BLOG_PATTERN.test(response.posts[0].blog_name.toLowerCase()) ||
      (!thread.blogUuid && response.posts[0].blog_name.toLowerCase() !== thread.blog) ||
      (thread.blogUuid && response.blog?.uuid !== thread.blogUuid)) {
    throw new Error("Tumblr returned an unexpected post response.");
  }
  const blogUuid = response.blog?.uuid;
  if (blogUuid !== undefined && (typeof blogUuid !== "string" || !BLOG_UUID_PATTERN.test(blogUuid))) {
    throw new Error("Tumblr returned an invalid blog UUID.");
  }
  if (response.blog?.name !== undefined &&
      (typeof response.blog.name !== "string" || response.blog.name.toLowerCase() !== response.posts[0].blog_name.toLowerCase())) {
    throw new Error("Tumblr returned inconsistent blog details.");
  }
  return { post: response.posts[0], blogUuid };
}

async function verifyPost(thread, apiKey, axios) {
  return (await verifyPostDetails(thread, apiKey, axios)).post;
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
      `https://api.tumblr.com/v2/blog/${thread.blogUuid ? encodeURIComponent(thread.blogUuid) : `${encodeURIComponent(thread.blog)}.tumblr.com`}/posts/${encodeURIComponent(thread.postId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, params: { post_format: "npf" }, timeout: 10000 }
    );
    const post = response.data && response.data.response;
    if (!post || typeof post !== "object" || Array.isArray(post)) throw new Error("Tumblr returned an unexpected authenticated post response.");
    if (trailPostId(post.id_string || post.id) !== thread.postId) throw new Error("Tumblr returned a different post.");
    return extractTrail(post);
  }
  if (!apiKey) throw new ValidationError("Set CONSUMER_KEY in .env to fetch the trail.");
  const response = await api.get(
    `https://api.tumblr.com/v2/blog/${thread.blogUuid ? encodeURIComponent(thread.blogUuid) : `${encodeURIComponent(thread.blog)}.tumblr.com`}/posts`,
    { params: { id: thread.postId, api_key: apiKey, npf: true, reblog_info: true }, timeout: 10000 }
  );
  const posts = response.data && response.data.response && response.data.response.posts;
  if (!Array.isArray(posts) || posts.length !== 1 || posts[0].id_string !== thread.postId ||
      typeof posts[0].blog_name !== "string" ||
      (thread.blogUuid ? response.data.response.blog?.uuid !== thread.blogUuid : posts[0].blog_name.toLowerCase() !== thread.blog)) {
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
      if (thread.notes !== undefined && (typeof thread.notes !== "string" || thread.notes.length > 1000)) {
        throw new Error("Tracked threads file contains invalid notes.");
      }
      if (thread.blogUuid !== undefined && (typeof thread.blogUuid !== "string" || !BLOG_UUID_PATTERN.test(thread.blogUuid))) {
        throw new Error("Tracked threads file contains an invalid blog UUID.");
      }
      if (thread.resolvedBlog !== undefined && (typeof thread.resolvedBlog !== "string" ||
          !BLOG_PATTERN.test(thread.resolvedBlog) || !thread.blogUuid)) {
        throw new Error("Tracked threads file contains an invalid resolved blog.");
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
          ...(thread.blogUuid ? { blogUuid: thread.blogUuid } : {}),
          ...(thread.resolvedBlog ? { resolvedBlog: thread.resolvedBlog } : {}),
          ...(partner ? { partner } : {}),
          ...(thread.partnerNumber !== undefined ? { partnerNumber: thread.partnerNumber } : {}),
          ...(thread.auId !== undefined ? { auId: thread.auId } : {}),
          ...(thread.notes ? { notes: thread.notes } : {}),
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
    writeRaw(threads.map(({ title, url, auId, completed, favourite, partnerNumber, blogUuid, resolvedBlog, notes }) => ({
      title, url, ...(auId ? { auId } : {}),
      ...(notes ? { notes } : {}),
      ...(blogUuid ? { blogUuid } : {}), ...(resolvedBlog ? { resolvedBlog } : {}),
      ...(completed ? { completed: true } : {}), ...(favourite ? { favourite: true } : {}),
      ...(partnerNumber !== undefined ? { partnerNumber } : {}),
    })));
  }

  return {
    list: read,
    add(title, url, auId, blogUuid) {
      const thread = { title: validateTitle(title), ...parsePostUrl(url) };
      if (blogUuid) {
        if (!BLOG_UUID_PATTERN.test(blogUuid)) throw new ValidationError("Invalid blog UUID.");
        thread.blogUuid = blogUuid;
        thread.resolvedBlog = thread.blog;
      }
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
    update(blog, postId, title, url, auId, completed, blogUuid) {
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
      if (threads[index].notes) thread.notes = threads[index].notes;
      if (thread.blog === blog && thread.postId === postId && threads[index].blogUuid) {
        thread.blogUuid = threads[index].blogUuid;
        if (threads[index].resolvedBlog) thread.resolvedBlog = threads[index].resolvedBlog;
      } else if (blogUuid) {
        if (!BLOG_UUID_PATTERN.test(blogUuid)) throw new ValidationError("Invalid blog UUID.");
        thread.blogUuid = blogUuid;
        thread.resolvedBlog = thread.blog;
      }
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
    setBlogIdentity(blog, postId, blogUuid, resolvedBlog) {
      if (typeof blogUuid !== "string" || !BLOG_UUID_PATTERN.test(blogUuid) ||
          typeof resolvedBlog !== "string" || !BLOG_PATTERN.test(resolvedBlog)) {
        throw new ValidationError("Invalid verified blog identity.");
      }
      const threads = read();
      const thread = threads.find((item) => item.blog === blog && item.postId === postId);
      if (!thread) return null;
      if (thread.blogUuid && thread.blogUuid !== blogUuid) {
        throw new ValidationError("The blog UUID changed; review this post manually.");
      }
      thread.blogUuid = blogUuid;
      thread.resolvedBlog = resolvedBlog;
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
    setNotes(blog, postId, notes) {
      if (typeof notes !== "string" || notes.length > 1000) {
        throw new ValidationError("Notes must be text of at most 1,000 characters.");
      }
      const threads = read();
      const thread = threads.find((item) => item.blog === blog && item.postId === postId);
      if (!thread) return null;
      if (notes) thread.notes = notes;
      else delete thread.notes;
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
    merge(primaryBlog, primaryPostId, secondaryBlog, secondaryPostId) {
      if (primaryBlog === secondaryBlog && primaryPostId === secondaryPostId) {
        throw new ValidationError("Choose two different posts to merge.");
      }
      const threads = read();
      const primary = threads.find((thread) => thread.blog === primaryBlog && thread.postId === primaryPostId);
      const secondary = threads.find((thread) => thread.blog === secondaryBlog && thread.postId === secondaryPostId);
      if (!primary || !secondary) return null;
      const partnerKeyPrimary = partnerKey(primary.title);
      const partnerKeySecondary = partnerKey(secondary.title);
      if (!partnerKeyPrimary || partnerKeyPrimary !== partnerKeySecondary) {
        throw new ValidationError("Only threads with the same writing partner can be merged.");
      }
      if (primary.notes && secondary.notes && primary.notes !== secondary.notes) {
        throw new ValidationError("Both threads have different notes. Combine or clear them before merging.");
      }
      const rawThreads = JSON.parse(fs.readFileSync(file, "utf8"));
      const primaryIndex = rawThreads.findIndex((thread) =>
        parsePostUrl(thread.url).blog === primaryBlog &&
        parsePostUrl(thread.url).postId === primaryPostId);
      const secondaryIndex = rawThreads.findIndex((thread) =>
        parsePostUrl(thread.url).blog === secondaryBlog &&
        parsePostUrl(thread.url).postId === secondaryPostId);
      if (primaryIndex === -1 || secondaryIndex === -1) return null;
      const primaryRaw = rawThreads[primaryIndex];
      const secondaryRaw = rawThreads[secondaryIndex];
      if (primaryRaw.completed || secondaryRaw.completed) primaryRaw.completed = true;
      else delete primaryRaw.completed;
      if (primaryRaw.favourite || secondaryRaw.favourite) primaryRaw.favourite = true;
      else delete primaryRaw.favourite;
      if (!primaryRaw.auId && secondaryRaw.auId) primaryRaw.auId = secondaryRaw.auId;
      if (!primaryRaw.notes && secondaryRaw.notes) primaryRaw.notes = secondaryRaw.notes;

      rawThreads.splice(secondaryIndex, 1);
      let number = 0;
      for (const thread of rawThreads) {
        if (partnerKey(thread.title) === partnerKeyPrimary) {
          thread.partnerNumber = ++number;
        }
      }
      writeRaw(rawThreads);
      return read().find((thread) => thread.blog === primaryBlog && thread.postId === primaryPostId);
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
    setNotes: (...args) => forBlog(getBlog()).setNotes(...args),
    setBlogIdentity: (...args) => forBlog(getBlog()).setBlogIdentity(...args),
    remove: (...args) => forBlog(getBlog()).remove(...args),
    merge: (...args) => forBlog(getBlog()).merge(...args),
  };
}

async function getLastReblog(thread, apiKey, axios) {
  if (!apiKey) throw new Error("Set CONSUMER_KEY in .env to fetch Tumblr notes.");
  const result = await axios.get(
    `https://api.tumblr.com/v2/blog/${thread.blogUuid ? encodeURIComponent(thread.blogUuid) : `${encodeURIComponent(thread.blog)}.tumblr.com`}/notes`,
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
      savedPost: { blog: post.blog_name, timestamp: post.timestamp, url: postFromId(post.blog_name, thread.postId).url },
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
      ...(typeof note.blog_uuid === "string" && /^t:[A-Za-z0-9_-]+$/.test(note.blog_uuid)
        ? { blogUuid: note.blog_uuid } : {}),
      timestamp: note.timestamp,
      url: postId ? `https://www.tumblr.com/${note.blog_name.toLowerCase()}/${postId}` : null,
    },
  };
}

module.exports = { createThreadStore, createBlogThreadStore, normalizeCollectionBlog, getLastReblog, getTrail, parsePostUrl, postFromId, validateTitle, verifyPost, verifyPostDetails, ValidationError, DuplicateThreadError };
