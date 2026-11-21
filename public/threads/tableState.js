"use strict";

const ThreadTable = {
  order(items, sortKey, direction, favouritesFirst = false) {
    const ordered = [...items];
    if (!sortKey && !favouritesFirst) return ordered;
    const value = (item) => {
      if (sortKey === "title" || sortKey === "blog") return item.thread[sortKey];
      const latest = item.lastReblog || item.savedPost;
      if (!latest) return null;
      if (sortKey === "reblogger") return latest.blog;
      return Number.isFinite(latest.timestamp) && Number.isFinite(new Date(latest.timestamp * 1000).getTime())
        ? latest.timestamp : null;
    };
    return ordered.sort((a, b) => {
      if (favouritesFirst && Boolean(a.thread.favourite) !== Boolean(b.thread.favourite)) {
        return a.thread.favourite ? -1 : 1;
      }
      if (!sortKey) return 0;
      const left = value(a);
      const right = value(b);
      if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
      const comparison = typeof left === "number" ? left - right : left.localeCompare(right, undefined, { sensitivity: "base" });
      return direction === "ascending" ? comparison : -comparison;
    });
  },
  matchesStatus(item, filter) {
    if (filter === "ongoing") return !item.thread.completed;
    if (filter === "completed") return Boolean(item.thread.completed);
    if (filter === "favourites") return Boolean(item.thread.favourite);
    return true;
  },
  matches(item, filterEnabled, defaultBlog, titleQuery = "", rebloggerQuery = "") {
    const title = titleQuery.trim().toLowerCase();
    const reblogger = rebloggerQuery.trim().toLowerCase();
    const latest = item.lastReblog || item.savedPost;
    return (!filterEnabled || Boolean(defaultBlog && item.lastReblog &&
      item.lastReblog.blog.toLowerCase() !== defaultBlog.toLowerCase())) &&
      (!title || item.thread.title.toLowerCase().includes(title)) &&
      (!reblogger || Boolean(latest && latest.blog.toLowerCase().includes(reblogger)));
  },
  page(items, size, requestedPage) {
    const pages = Math.max(1, Math.ceil(items.length / size));
    const current = Math.min(Math.max(1, requestedPage), pages);
    const start = (current - 1) * size;
    return { items: items.slice(start, start + size), current, pages, total: items.length, start };
  },
};

if (typeof module !== "undefined") module.exports = ThreadTable;
