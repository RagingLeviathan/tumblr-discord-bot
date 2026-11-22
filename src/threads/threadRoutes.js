"use strict";

const express = require("express");
const axios = require("axios");
const { createBlogThreadStore, normalizeCollectionBlog, getLastReblog, getTrail, parsePostUrl, postFromId, validateTitle, verifyPostDetails, ValidationError, DuplicateThreadError } = require("./threadTracker");
const { getThreadBlog } = require("../config/blogConfig");
const { createAuStore } = require("./auStore");
const { createAskStore } = require("./askStore");

function createThreadRoutes({ getBlog = getThreadBlog, store = createBlogThreadStore({ getBlog }), auStore = createAuStore, askStore = createAskStore, api = axios, getApiKey = () => process.env.CONSUMER_KEY, getAccessToken = () => null, getReblog = getLastReblog, getCachedReblogs = null, verifyCachedPost = verifyPostDetails } = {}) {
  const router = express.Router();

  router.use(express.json({ limit: "16kb" }));

  router.get("/config", (req, res) => {
    try {
      res.json({ defaultBlog: normalizeCollectionBlog(getBlog()) });
    } catch (error) {
      console.error("Could not read thread blog configuration:", error.message);
      res.status(500).json({ error: "Could not read thread blog configuration. Check the server log." });
    }
  });

  router.use((req, res, next) => {
    try {
      req.threadBlog = normalizeCollectionBlog(getBlog());
      if (req.get("X-Thread-Blog") && req.get("X-Thread-Blog") !== req.threadBlog) {
        return res.status(409).json({ error: "The configured blog changed. Refresh the thread list before continuing." });
      }
      req.threadStore = store.forBlog ? store.forBlog(req.threadBlog) : store;
      req.auStore = auStore(req.threadBlog);
      req.askStore = askStore(req.threadBlog);
      next();
    } catch (error) {
      console.error("Could not open thread collection:", error.message);
      res.status(500).json({ error: "Could not open thread collection. Check the server log." });
    }
  });

  router.get("/", (req, res) => {
    try {
      res.json(req.threadStore.list());
    } catch (error) {
      console.error("Could not read tracked threads:", error.message);
      res.status(500).json({ error: "Could not read tracked threads. Check the server log." });
    }
  });

  router.get("/reblogs/cache", (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      if (!getCachedReblogs) throw new Error("Reblog cache is unavailable.");
      res.json(getCachedReblogs(req.threadStore.list()));
    } catch (error) {
      console.error("Could not read cached reblogs:", error.message);
      res.status(500).json({ error: "Could not read cached reblogs. Check the server log." });
    }
  });

  router.get("/aus", (req, res) => {
    try {
      res.json(req.auStore.list());
    } catch (error) {
      console.error("Could not read AUs:", error.message);
      res.status(500).json({ error: "Could not read AUs. Check the server log." });
    }
  });

  router.get("/asks", (req, res) => {
    try {
      res.json(req.askStore.list());
    } catch (error) {
      console.error("Could not read saved asks:", error.message);
      res.status(500).json({ error: "Could not read saved asks. Check the server log." });
    }
  });

  router.post("/asks", (req, res) => {
    try {
      const { url, note } = req.body || {};
      res.status(201).json(req.askStore.add(url, note));
    } catch (error) {
      if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
      console.error("Could not save ask:", error.message);
      res.status(500).json({ error: "Could not save ask. Check the server log." });
    }
  });

  router.delete("/asks/:id", (req, res) => {
    try {
      if (!req.askStore.remove(req.params.id)) return res.status(404).json({ error: "Saved ask not found." });
      res.status(204).end();
    } catch (error) {
      console.error("Could not remove saved ask:", error.message);
      res.status(500).json({ error: "Could not remove saved ask. Check the server log." });
    }
  });

  function saveAu(req, res, isEdit) {
    try {
      const { name, shortName, verseUrl } = req.body || {};
      const au = isEdit ? req.auStore.update(req.params.id, name, shortName, verseUrl) : req.auStore.add(name, shortName, verseUrl);
      if (!au) return res.status(404).json({ error: "AU not found." });
      res.status(isEdit ? 200 : 201).json(au);
    } catch (error) {
      if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
      console.error("Could not save AU:", error.message);
      res.status(500).json({ error: "Could not save AU. Check the server log." });
    }
  }

  router.post("/aus", (req, res) => saveAu(req, res, false));
  router.put("/aus/:id", (req, res) => saveAu(req, res, true));
  router.delete("/aus/:id", (req, res) => {
    try {
      if (req.threadStore.list().some((thread) => thread.auId === req.params.id)) {
        return res.status(409).json({ error: "This AU is assigned to threads. Unassign them before deleting it." });
      }
      if (!req.auStore.remove(req.params.id)) return res.status(404).json({ error: "AU not found." });
      res.status(204).end();
    } catch (error) {
      console.error("Could not remove AU:", error.message);
      res.status(500).json({ error: "Could not remove AU. Check the server log." });
    }
  });

  async function saveThread(req, res, isEdit) {
    try {
      const { title, url, blog, postId, auId, completed } = req.body || {};
      const existing = isEdit ? req.threadStore.list().find((item) =>
        item.blog === req.params.blog && item.postId === req.params.postId
      ) : null;
      if (isEdit && !existing) return res.status(404).json({ error: "Tracked thread not found." });
      validateTitle(title);
      if (postId !== undefined && url !== undefined) throw new ValidationError("Provide either a URL or a post ID, not both.");
      const reference = postId !== undefined
        ? postFromId(blog === undefined ? req.threadBlog : blog, postId)
        : parsePostUrl(url);
      const duplicate = req.threadStore.list().find((item) =>
        item.blog === reference.blog && item.postId === reference.postId &&
        (!existing || item.blog !== existing.blog || item.postId !== existing.postId)
      );
      if (duplicate) throw new DuplicateThreadError(duplicate);
      let verifiedUuid;
      if (postId !== undefined) {
        if (!existing || existing.blog !== reference.blog || existing.postId !== reference.postId) {
          const apiKey = getApiKey();
          if (!apiKey) return res.status(503).json({ error: "Set CONSUMER_KEY in .env to verify Tumblr posts.", canSaveUnverified: true });
          try {
            verifiedUuid = (await verifyPostDetails(reference, apiKey, api)).blogUuid;
          } catch (error) {
            if (error instanceof ValidationError) return res.status(400).json({ error: error.message, canSaveUnverified: true });
            if (error.response && error.response.status === 404) {
              return res.status(404).json({ error: "Tumblr could not find or access this post. Check the publishing blog and post ID; restricted posts may not be available through the public API.", canSaveUnverified: true });
            }
            if (error.response) {
              return res.status(502).json({ error: `Tumblr returned HTTP ${error.response.status} while verifying the post.`, canSaveUnverified: true });
            }
            console.error("Could not verify Tumblr post:", error.message);
            if (error.code === "ECONNABORTED") return res.status(502).json({ error: "Tumblr post verification timed out.", canSaveUnverified: true });
            return res.status(502).json({ error: "Could not verify the post with Tumblr. Check the server log.", canSaveUnverified: true });
          }
        }
      }
      if (normalizeCollectionBlog(getBlog()) !== req.threadBlog) {
        return res.status(409).json({ error: "The configured blog changed. Refresh the thread list before continuing." });
      }
      if (auId !== undefined && auId !== null &&
          (typeof auId !== "string" || !req.auStore.list().some((au) => au.id === auId))) {
        throw new ValidationError("Choose an existing AU or leave it unassigned.");
      }
      const result = isEdit
        ? req.threadStore.update(req.params.blog, req.params.postId, title, reference.url, auId, completed, verifiedUuid)
        : req.threadStore.add(title, reference.url, auId, verifiedUuid);
      if (!result) return res.status(404).json({ error: "Tracked thread not found." });
      res.status(isEdit ? 200 : 201).json(result);
    } catch (error) {
      if (error instanceof DuplicateThreadError) return res.status(400).json({ error: error.message, duplicate: error.thread });
      if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
      console.error("Could not save tracked thread:", error.message);
      res.status(500).json({ error: "Could not save tracked thread. Check the server log." });
    }
  }

  router.post("/", (req, res) => saveThread(req, res, false));
  router.put("/:blog/:postId", (req, res) => saveThread(req, res, true));

  router.post("/:blog/:postId/identity", async (req, res) => {
    try {
      if (!req.get("X-Thread-Blog")) return res.status(400).json({ error: "Refresh the thread list first." });
      const thread = req.threadStore.list().find((item) =>
        item.blog === req.params.blog && item.postId === req.params.postId);
      if (!thread) return res.status(404).json({ error: "Tracked thread not found." });
      const { post, blogUuid } = await verifyCachedPost(thread, getApiKey(), api);
      if (!blogUuid) return res.status(422).json({ error: "Tumblr did not provide a blog UUID; review this post manually." });
      if (normalizeCollectionBlog(getBlog()) !== req.threadBlog) {
        return res.status(409).json({ error: "The configured blog changed. Refresh the thread list before continuing." });
      }
      const updated = req.threadStore.setBlogIdentity(thread.blog, thread.postId, blogUuid, post.blog_name.toLowerCase());
      if (!updated) return res.status(409).json({ error: "The tracked post changed during verification." });
      res.json(updated);
    } catch (error) {
      if (error instanceof ValidationError) return res.status(422).json({ error: error.message });
      if (error.response?.status === 429) return res.status(429).json({ error: "Tumblr rate limit reached. Try again after the cooldown." });
      console.error("Could not verify thread blog identity:", error.code || error.response?.status || error.message);
      res.status(502).json({ error: error.response ? `Tumblr returned HTTP ${error.response.status}. Review this post manually.` : "Could not verify the post. Check the server log." });
    }
  });

  router.patch("/:blog/:postId/status", (req, res) => {
    try {
      const thread = req.threadStore.setFlags(req.params.blog, req.params.postId, req.body);
      if (!thread) return res.status(404).json({ error: "Tracked thread not found." });
      res.json(thread);
    } catch (error) {
      if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
      console.error("Could not update thread status:", error.message);
      res.status(500).json({ error: "Could not update thread status. Check the server log." });
    }
  });

  router.patch("/:blog/:postId/notes", (req, res) => {
    try {
      if (!req.get("X-Thread-Blog")) return res.status(400).json({ error: "Refresh the thread list first." });
      const thread = req.threadStore.setNotes(req.params.blog, req.params.postId, req.body?.notes);
      if (!thread) return res.status(404).json({ error: "Tracked thread not found." });
      res.json(thread);
    } catch (error) {
      if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
      console.error("Could not save thread notes:", error.message);
      res.status(500).json({ error: "Could not save thread notes. Check the server log." });
    }
  });

  router.post("/:blog/:postId/merge", (req, res) => {
    try {
      const { keepBlog, keepPostId } = req.body || {};
      if (typeof keepBlog !== "string" || typeof keepPostId !== "string") {
        throw new ValidationError("Choose the post to keep.");
      }
      const merged = req.threadStore.merge(
        normalizeCollectionBlog(keepBlog),
        keepPostId,
        req.params.blog,
        req.params.postId,
      );
      if (!merged) return res.status(404).json({ error: "Tracked thread not found." });
      res.json(merged);
    } catch (error) {
      if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
      console.error("Could not merge tracked threads:", error.message);
      res.status(500).json({ error: "Could not merge tracked threads. Check the server log." });
    }
  });

  router.delete("/:blog/:postId", (req, res) => {
    try {
      if (!req.threadStore.remove(req.params.blog, req.params.postId)) {
        return res.status(404).json({ error: "Tracked thread not found." });
      }
      res.status(204).end();
    } catch (error) {
      console.error("Could not remove tracked thread:", error.message);
      res.status(500).json({ error: "Could not remove tracked thread. Check the server log." });
    }
  });

  router.get("/:blog/:postId/reblog", async (req, res) => {
    try {
      const thread = req.threadStore.list().find((item) =>
        item.blog === req.params.blog && item.postId === req.params.postId
      );
      if (!thread) return res.status(404).json({ error: "Tracked thread not found." });
      if (req.query.force !== undefined && req.query.force !== "1") {
        return res.status(400).json({ error: "Invalid reblog refresh option." });
      }
      res.json(await getReblog(thread, getApiKey(), api, { force: req.query.force === "1" }));
    } catch (error) {
      console.error("Could not fetch thread reblogs:", error.message);
      if (error.response) {
        if (error.response.status === 429) return res.status(429).json({ error: "Tumblr rate limit reached. Try again after the cooldown." });
        if (error.response.status === 403 || error.response.status === 404) {
          return res.status(502).json({ error: `Tumblr could not access reblog details for this post (HTTP ${error.response.status}). The post may be restricted or unavailable.` });
        }
        return res.status(502).json({ error: `Tumblr returned HTTP ${error.response.status}.` });
      }
      if (error.code === "ECONNABORTED") return res.status(502).json({ error: "Tumblr request timed out." });
      res.status(502).json({ error: error.code ? "Could not reach Tumblr. Check the server log." : error.message });
    }
  });

  router.get("/:blog/:postId/trail", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      if (!req.get("X-Thread-Blog")) return res.status(400).json({ error: "Refresh the thread list first." });
      if (req.query.mode !== "public" && req.query.mode !== "authenticated") {
        return res.status(400).json({ error: "Choose a public or authenticated trail lookup." });
      }
      const thread = req.threadStore.list().find((item) =>
        item.blog === req.params.blog && item.postId === req.params.postId
      );
      if (!thread) return res.status(404).json({ error: "Tracked thread not found." });
      const result = await getTrail(thread, { api, apiKey: getApiKey(), accessToken: getAccessToken(),
        authenticated: req.query.mode === "authenticated" });
      res.json(result);
    } catch (error) {
      if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
      console.error("Could not fetch trail:", error.code || (error.response && error.response.status) || error.name);
      if (error.response) return res.status(502).json({ error: `Tumblr returned HTTP ${error.response.status} for the trail lookup. Check access or reauthorize if needed.` });
      if (error.code === "ECONNABORTED") return res.status(502).json({ error: "Tumblr trail lookup timed out." });
      res.status(502).json({ error: "Could not fetch the trail. Check the server log." });
    }
  });

  return router;
}

module.exports = { createThreadRoutes };
