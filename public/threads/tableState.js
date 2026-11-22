"use strict";

const ThreadTable = {
  formatPostDate(timestamp) {
    if (!Number.isFinite(timestamp)) return null;
    const date = new Date(timestamp * 1000);
    if (!Number.isFinite(date.getTime())) return null;
    const day = date.getDate();
    const suffix = day % 100 >= 11 && day % 100 <= 13
      ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th");
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return {
      date: `${date.toLocaleString("en-US", { month: "long" })} ${day}${suffix}, ${date.getFullYear()}`,
      time: `${hours % 12 || 12}.${minutes}.${seconds} ${hours < 12 ? "am" : "pm"}`,
    };
  },
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
  rebloggers(items) {
    const names = new Map();
    for (const item of items) {
      const latest = item.lastReblog || item.savedPost;
      if (latest && typeof latest.blog === "string" && latest.blog) {
        const key = latest.blogUuid ? `uuid:${latest.blogUuid}` : latest.blog.toLowerCase();
        const checkedAt = item.cache?.checkedAt ?? -1;
        if (!names.has(key) || checkedAt > names.get(key).checkedAt) {
          names.set(key, { name: latest.blog, checkedAt });
        }
      }
    }
    const entries = [...names.entries()].map(([key, value]) => [key, value.name]);
    const counts = new Map();
    for (const [, name] of entries) counts.set(name.toLowerCase(), (counts.get(name.toLowerCase()) || 0) + 1);
    for (const entry of entries) {
      if (counts.get(entry[1].toLowerCase()) > 1) {
        entry[1] += entry[0].startsWith("uuid:") ? ` (${entry[0].slice(5)})` : " (UUID unknown)";
      }
    }
    return entries.sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: "base" }));
  },
  possibleDuplicates(items) {
    const groups = new Map();
    for (const item of items) {
      const reblog = item.lastReblog;
      if (!reblog || typeof reblog.blog !== "string" || !reblog.blog ||
          !Number.isFinite(reblog.timestamp) || !Number.isFinite(new Date(reblog.timestamp * 1000).getTime())) continue;
      const identity = reblog.blogUuid ? `uuid:${reblog.blogUuid}` : `name:${reblog.blog.toLowerCase()}`;
      const key = `${identity}\0${reblog.timestamp}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const counts = new Map();
    for (const group of groups.values()) {
      if (group.length > 1) for (const item of group) counts.set(item, group.length);
    }
    return counts;
  },
  matches(item, filterEnabled, defaultBlog, titleQuery = "", rebloggerQuery = "", selectedReblogger = "") {
    const title = titleQuery.trim().toLowerCase();
    const reblogger = rebloggerQuery.trim().toLowerCase();
    const latest = item.lastReblog || item.savedPost;
    return (!filterEnabled || Boolean(defaultBlog && item.lastReblog &&
      item.lastReblog.blog.toLowerCase() !== defaultBlog.toLowerCase())) &&
      (!title || item.thread.title.toLowerCase().includes(title)) &&
      (!reblogger || Boolean(latest && latest.blog.toLowerCase().includes(reblogger))) &&
      (!selectedReblogger || Boolean(latest && (selectedReblogger.startsWith("uuid:")
        ? `uuid:${latest.blogUuid}` === selectedReblogger
        : !latest.blogUuid && latest.blog.toLowerCase() === selectedReblogger.toLowerCase())));
  },
  random(items, random = Math.random) {
    return items.length ? items[Math.floor(random() * items.length)] : null;
  },
  page(items, size, requestedPage) {
    const pages = Math.max(1, Math.ceil(items.length / size));
    const current = Math.min(Math.max(1, requestedPage), pages);
    const start = (current - 1) * size;
    return { items: items.slice(start, start + size), current, pages, total: items.length, start };
  },
};

if (typeof module !== "undefined") module.exports = ThreadTable;
