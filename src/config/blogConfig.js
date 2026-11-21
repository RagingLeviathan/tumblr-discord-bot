"use strict";

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const initialBlog = process.env.BLOG_NAME;

function getDefaultBlog() {
  return (process.env.BLOG_NAME || "").trim() || "iobartach";
}

function createThreadBlogResolver({ envFile = path.resolve(process.cwd(), ".env"), environmentBlog = initialBlog } = {}) {
  return () => {
    let values;
    try {
      values = dotenv.parse(fs.readFileSync(envFile));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      values = {};
    }
    const blog = Object.prototype.hasOwnProperty.call(values, "BLOG_NAME") ? values.BLOG_NAME : environmentBlog;
    return (blog || "").trim() || "iobartach";
  };
}

const getThreadBlog = createThreadBlogResolver();

module.exports = { getDefaultBlog, getThreadBlog, createThreadBlogResolver };
