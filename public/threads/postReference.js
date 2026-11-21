"use strict";

const PostReference = (() => {
  const BLOG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

  class ValidationError extends Error {}

  function postFromId(blog, postId) {
    if (typeof blog !== "string" || !BLOG_PATTERN.test(blog.trim().toLowerCase())) {
      throw new ValidationError("Enter a valid Tumblr blog name.");
    }
    if (typeof postId !== "string" || !/^\d+$/.test(postId.trim())) {
      throw new ValidationError("Enter a numeric Tumblr post ID.");
    }
    blog = blog.trim().toLowerCase();
    postId = postId.trim();
    return { blog, postId, url: `https://www.tumblr.com/${blog}/${postId}` };
  }

  function parsePostUrl(input) {
    let url;
    try {
      url = new URL(input);
    } catch {
      throw new ValidationError("Enter a valid Tumblr post URL.");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.port) {
      throw new ValidationError("Enter an HTTPS Tumblr post URL.");
    }

    const host = url.hostname.toLowerCase();
    const segments = url.pathname.split("/").filter(Boolean);
    let blog;
    let postId;
    if (host === "www.tumblr.com" || host === "tumblr.com") {
      [blog, postId] = segments;
    } else if (host.endsWith(".tumblr.com")) {
      blog = host.slice(0, -".tumblr.com".length);
      if (segments[0] === "post") {
        postId = segments[1];
      }
    }

    if (!blog || !BLOG_PATTERN.test(blog.toLowerCase()) || !/^\d+$/.test(postId || "")) {
      throw new ValidationError("Enter a Tumblr post URL containing a blog name and post ID.");
    }
    return postFromId(blog, postId);
  }

  return { BLOG_PATTERN, ValidationError, postFromId, parsePostUrl };
})();

if (typeof module !== "undefined") module.exports = PostReference;
