"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { order, matches, matchesStatus, page } = require("../public/threads/tableState");

const items = [
  { thread: { title: "zulu", blog: "alpha" }, lastReblog: { blog: "Other", timestamp: 100 } },
  { thread: { title: "Alpha", blog: "zulu" }, lastReblog: { blog: "iobartach", timestamp: 300 } },
  { thread: { title: "middle", blog: "middle" }, lastReblog: null },
  { thread: { title: "Beta", blog: "beta" }, lastReblog: { blog: "Beta", timestamp: 200 } },
];

test("sorts each column both ways and keeps missing reblog data last", () => {
  const titles = (key, direction) => order(items, key, direction).map((item) => item.thread.title);
  assert.deepEqual(titles("title", "ascending"), ["Alpha", "Beta", "middle", "zulu"]);
  assert.deepEqual(titles("title", "descending"), ["zulu", "middle", "Beta", "Alpha"]);
  assert.deepEqual(titles("blog", "ascending"), ["zulu", "Beta", "middle", "Alpha"]);
  assert.deepEqual(titles("blog", "descending"), ["Alpha", "middle", "Beta", "zulu"]);
  assert.deepEqual(titles("reblogger", "ascending"), ["Beta", "Alpha", "zulu", "middle"]);
  assert.deepEqual(titles("reblogger", "descending"), ["zulu", "Alpha", "Beta", "middle"]);
  assert.deepEqual(titles("date", "ascending"), ["zulu", "Beta", "Alpha", "middle"]);
  assert.deepEqual(titles("date", "descending"), ["Alpha", "Beta", "zulu", "middle"]);
  assert.deepEqual(order(items, null, "ascending"), items);
});

test("filters case-insensitively and excludes unknown rebloggers only when enabled", () => {
  assert.deepEqual(items.filter((item) => matches(item, true, "IOBARTACH")).map((item) => item.thread.title), ["zulu", "Beta"]);
  assert.equal(items.filter((item) => matches(item, false, null)).length, 4);
  assert.equal(items.filter((item) => matches(item, true, null)).length, 0);
});

test("sorts saved post fallback while retaining reblog-only filter behavior", () => {
  const fallback = { thread: { title: "fallback" }, lastReblog: null, savedPost: { blog: "aardvark", timestamp: 250 } };
  const entries = [...items, fallback];
  assert.equal(order(entries, "reblogger", "ascending")[0], fallback);
  assert.deepEqual(order(entries, "date", "ascending").map((item) => item.thread.title), ["zulu", "Beta", "fallback", "Alpha", "middle"]);
  assert.equal(matches(fallback, true, "iobartach"), false);
});

test("combines case-insensitive partial title and displayed reblogger searches", () => {
  const fallback = { thread: { title: "Another Story" }, lastReblog: null, savedPost: { blog: "Author" } };
  const entries = [...items, fallback];
  assert.deepEqual(entries.filter((item) => matches(item, false, "iobartach", "  UL ", " oTh "))
    .map((item) => item.thread.title), ["zulu"]);
  assert.deepEqual(entries.filter((item) => matches(item, false, "iobartach", "story", "THOR"))
    .map((item) => item.thread.title), ["Another Story"]);
  assert.equal(matches(fallback, true, "iobartach", "", "author"), false);
  assert.equal(matches(items[2], false, "iobartach", "", "middle"), false);
  assert.equal(matches(items[2], false, "iobartach", " MID ", "  "), true);
  assert.equal(matches(items[0], false, "iobartach", "zulu", "missing"), false);
});

test("paginates filtered results and clamps a page after removals", () => {
  const entries = Array.from({ length: 26 }, (_, index) => index);
  assert.deepEqual(page(entries, 10, 2).items, entries.slice(10, 20));
  assert.deepEqual(page(entries, 25, 2).items, [25]);
  assert.equal(page(entries, 50, 2).current, 1);
  assert.equal(page(entries, 100, 1).items.length, 26);
  assert.deepEqual(page([], 10, 3), { items: [], current: 1, pages: 1, total: 0, start: 0 });
});

test("filters ongoing, completed and favourites independently", () => {
  const entries = [
    { thread: { title: "Ongoing" } },
    { thread: { title: "Completed", completed: true } },
    { thread: { title: "Ongoing favourite", favourite: true } },
    { thread: { title: "Completed favourite", completed: true, favourite: true } },
  ];
  const titles = (filter) => entries.filter((item) => matchesStatus(item, filter)).map((item) => item.thread.title);
  assert.deepEqual(titles("all"), entries.map((item) => item.thread.title));
  assert.deepEqual(titles("ongoing"), ["Ongoing", "Ongoing favourite"]);
  assert.deepEqual(titles("completed"), ["Completed", "Completed favourite"]);
  assert.deepEqual(titles("favourites"), ["Ongoing favourite", "Completed favourite"]);
});

test("places favourites first without changing the selected sort within each group", () => {
  const entries = [
    { thread: { title: "B" }, lastReblog: null },
    { thread: { title: "Z", favourite: true }, lastReblog: null },
    { thread: { title: "A", favourite: true }, lastReblog: { blog: "other", timestamp: 100 } },
    { thread: { title: "C" }, lastReblog: { blog: "other", timestamp: 200 } },
  ];
  const titles = (key, direction, first) => order(entries, key, direction, first).map((item) => item.thread.title);
  assert.deepEqual(titles(null, "ascending", true), ["Z", "A", "B", "C"]);
  assert.deepEqual(titles("title", "ascending", true), ["A", "Z", "B", "C"]);
  assert.deepEqual(titles("title", "descending", true), ["Z", "A", "C", "B"]);
  assert.deepEqual(titles("date", "descending", true), ["A", "Z", "C", "B"]);
  assert.deepEqual(titles("title", "ascending", false), ["A", "B", "C", "Z"]);
});
