"use strict";

const express = require("express");
const axios = require("axios");
const { createBlogThreadStore, normalizeCollectionBlog, getLastReblog, getTrail, postFromId, validateTitle, verifyPost, ValidationError } = require("./threadTracker");
const { getThreadBlog } = require("../config/blogConfig");
const { createAuStore } = require("./auStore");

function createThreadRoutes({ getBlog = getThreadBlog, store = createBlogThreadStore({ getBlog }), auStore = createAuStore, api = axios, getApiKey = () => process.env.CONSUMER_KEY, getAccessToken = () => null } = {}) {
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

  router.get("/aus", (req, res) => {
    try {
      res.json(req.auStore.list());
    } catch (error) {
      console.error("Could not read AUs:", error.message);
      res.status(500).json({ error: "Could not read AUs. Check the server log." });
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
      let newUrl = url;
      if (postId !== undefined) {
        if (url !== undefined) throw new ValidationError("Provide either a URL or a post ID, not both.");
        const thread = postFromId(blog === undefined ? req.threadBlog : blog, postId);
        if (!existing || existing.blog !== thread.blog || existing.postId !== thread.postId) {
          const apiKey = getApiKey();
          if (!apiKey) return res.status(503).json({ error: "Set CONSUMER_KEY in .env to verify Tumblr posts." });
          try {
            await verifyPost(thread, apiKey, api);
          } catch (error) {
            if (error instanceof ValidationError) throw error;
            if (error.response && error.response.status === 404) {
              return res.status(404).json({ error: "Post not found or inaccessible on this blog. Check the blog name and post ID." });
            }
            if (error.response) {
              return res.status(502).json({ error: `Tumblr returned HTTP ${error.response.status} while verifying the post.` });
            }
            console.error("Could not verify Tumblr post:", error.message);
            if (error.code === "ECONNABORTED") return res.status(502).json({ error: "Tumblr post verification timed out." });
            return res.status(502).json({ error: "Could not verify the post with Tumblr. Check the server log." });
          }
        }
        newUrl = thread.url;
      }
      if (normalizeCollectionBlog(getBlog()) !== req.threadBlog) {
        return res.status(409).json({ error: "The configured blog changed. Refresh the thread list before continuing." });
      }
      if (auId !== undefined && auId !== null &&
          (typeof auId !== "string" || !req.auStore.list().some((au) => au.id === auId))) {
        throw new ValidationError("Choose an existing AU or leave it unassigned.");
      }
      const result = isEdit
        ? req.threadStore.update(req.params.blog, req.params.postId, title, newUrl, auId, completed)
        : req.threadStore.add(title, newUrl, auId);
      if (!result) return res.status(404).json({ error: "Tracked thread not found." });
      res.status(isEdit ? 200 : 201).json(result);
    } catch (error) {
      if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
      console.error("Could not save tracked thread:", error.message);
      res.status(500).json({ error: "Could not save tracked thread. Check the server log." });
    }
  }

  router.post("/", (req, res) => saveThread(req, res, false));
  router.put("/:blog/:postId", (req, res) => saveThread(req, res, true));

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
      res.json(await getLastReblog(thread, getApiKey(), api));
    } catch (error) {
      console.error("Could not fetch thread reblogs:", error.message);
      if (error.response) {
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
