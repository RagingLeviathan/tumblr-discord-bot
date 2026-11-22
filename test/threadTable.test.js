"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { order, matches, matchesStatus, page, random, rebloggers, formatPostDate, possibleDuplicates } = require("../public/threads/tableState");

const items = [
  { thread: { title: "zulu", blog: "alpha" }, lastReblog: { blog: "Other", timestamp: 100 } },
  { thread: { title: "Alpha", blog: "zulu" }, lastReblog: { blog: "iobartach", timestamp: 300 } },
  { thread: { title: "middle", blog: "middle" }, lastReblog: null },
  { thread: { title: "Beta", blog: "beta" }, lastReblog: { blog: "Beta", timestamp: 200 } },
];

test("formats post dates with ordinal days and local time including seconds", () => {
  const timestamp = (day, hour = 18, minute = 23, second = 25) => new Date(2026, 8, day, hour, minute, second).getTime() / 1000;
  assert.deepEqual(formatPostDate(timestamp(8)), { date: "September 8th, 2026", time: "6.23.25 pm" });
  assert.deepEqual(formatPostDate(timestamp(1, 0, 5, 6)), { date: "September 1st, 2026", time: "12.05.06 am" });
  assert.deepEqual(formatPostDate(timestamp(2, 12, 0, 0)), { date: "September 2nd, 2026", time: "12.00.00 pm" });
  assert.equal(formatPostDate(timestamp(3)).date, "September 3rd, 2026");
  for (const day of [11, 12, 13]) assert.equal(formatPostDate(timestamp(day)).date, `September ${day}th, 2026`);
  assert.equal(formatPostDate(timestamp(21)).date, "September 21st, 2026");
  assert.equal(formatPostDate(null), null);
  assert.equal(formatPostDate(Infinity), null);
  assert.equal(formatPostDate(1e20), null);
});

test("renders the post date and time separately, including unknown dates", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "threads", "threads.js"), "utf8");
  const render = source.slice(source.indexOf("function renderReblog("), source.indexOf("\nasync function loadReblog("));
  assert.ok(render.startsWith("function renderReblog("));
  const timestamp = new Date(2026, 8, 8, 18, 23, 25).getTime() / 1000;
  const latest = { blog: "example", timestamp };
  const context = {
    ThreadTable: { formatPostDate },
    document: {
      createElement: () => ({}),
      createTextNode: (text) => ({ textContent: text }),
    },
  };
  vm.createContext(context);
  vm.runInContext(render, context);
  const item = {
    thread: {},
    poster: { replaceChildren() {}, classList: { remove() {} } },
    date: { replaceChildren(...children) { this.children = children; } },
  };
  context.renderReblog(item, { lastReblog: latest, savedPost: null });
  assert.equal(item.date.children[0].textContent, "September 8th, 2026");
  assert.equal(item.date.children[1].className, "post-time");
  assert.equal(item.date.children[1].textContent, "6.23.25 pm");
  assert.equal(item.date.title, new Date(timestamp * 1000).toLocaleString());
  latest.timestamp = null;
  context.renderReblog(item, { lastReblog: latest, savedPost: null });
  assert.equal(item.date.textContent, "Unknown date");
  assert.equal(item.date.title, "Unknown date");
});

test("checks only currently visible uncached or expired rows", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "threads", "threads.js"), "utf8");
  const check = source.slice(source.indexOf("async function checkVisible("), source.indexOf("\nfunction renderReblog("));
  assert.ok(check.startsWith("async function checkVisible("));
  const first = { checkState: "needed" };
  const hidden = { checkState: "needed" };
  const nextPage = { checkState: "needed" };
  const fresh = { checkState: "fresh", cache: { checkedAt: Date.now(), freshUntil: Date.now() + 60000 } };
  const expired = { checkState: "fresh", cache: { checkedAt: Date.now() - 60000, freshUntil: Date.now() - 1 } };
  let release;
  const calls = [];
  const context = {
    loadingThreads: false, checkingVisible: false, visibleItems: [first, hidden, fresh],
    loadReblog: async (item) => {
      calls.push(item);
      item.checkState = "checking";
      if (item === first) await new Promise((resolve) => { release = resolve; });
      item.checkState = "done";
    },
  };
  vm.createContext(context);
  vm.runInContext(check, context);
  const pending = context.checkVisible();
  assert.deepEqual(calls, [first]);
  context.visibleItems = [nextPage, fresh, expired];
  release();
  await pending;
  assert.deepEqual(calls, [first, nextPage, expired]);
  assert.equal(hidden.checkState, "needed");
});

test("bulk identity updates include hidden rows and stop on rate limits or cancellation", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "threads", "threads.js"), "utf8");
  const handler = source.slice(source.indexOf('updateIdsButton.addEventListener("click"'), source.indexOf('\nrandomThreadButton.addEventListener("click"'));
  assert.ok(handler.startsWith('updateIdsButton.addEventListener("click"'));
  for (const cancel of [false, true]) {
    let start;
    let release;
    const calls = [];
    const rows = ["1", "2", "3"].map((postId) => ({
      thread: { title: `Thread ${postId}`, blog: "root", postId },
      row: { querySelector: () => ({}) },
    }));
    const errors = [];
    const context = {
      items: rows, defaultBlog: "owner", cancelIds: false,
      window: { confirm: () => true },
      updateIdsButton: { addEventListener: (_event, callback) => { start = callback; } },
      cancelIdsButton: {}, updateIdsStatus: {},
      updateIdsErrors: { replaceChildren() { errors.length = 0; }, append(entry) { errors.push(entry.textContent); } },
      document: { createElement: () => ({}) },
      threadPath: (thread) => `/threads/${thread.postId}`,
      PostReference: { postFromId: (blog, postId) => ({ url: `https://www.tumblr.com/${blog}/${postId}` }) },
      renderReblog(item, result) { item.lastReblog = result.lastReblog; },
      updateDuplicateHighlights() {}, updateRebloggerOptions() {}, updateTable() {},
      request: async (url) => {
        calls.push(url);
        if (cancel) await new Promise((resolve) => { release = resolve; });
        if (url === "/threads/2/identity") throw Object.assign(new Error("limited"), { status: 429 });
        if (url.endsWith("/identity")) return { ...rows[0].thread, resolvedBlog: "renamed", blogUuid: "t:Root" };
        return { lastReblog: { blog: "author", blogUuid: "t:Author" }, cache: { stale: false } };
      },
    };
    vm.createContext(context);
    vm.runInContext(handler, context);
    const pending = start();
    if (cancel) {
      context.cancelIds = true;
      release();
    }
    await pending;
    if (cancel) {
      assert.deepEqual(calls, ["/threads/1/identity"]);
      assert.match(context.updateIdsStatus.textContent, /Stopped by user/);
    } else {
      assert.deepEqual(calls, ["/threads/1/identity", "/threads/1/reblog?force=1", "/threads/2/identity"]);
      assert.match(context.updateIdsStatus.textContent, /rate limit/i);
      assert.match(errors[0], /Thread 2.*limited/);
    }
  }
});

test("keeps cached results visible when an individual check fails", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "threads", "threads.js"), "utf8");
  const load = source.slice(source.indexOf("async function loadReblog("), source.indexOf("\nasync function refresh("));
  assert.ok(load.startsWith("async function loadReblog("));
  const item = {
    thread: {}, lastReblog: { blog: "author", timestamp: 123 }, checkState: "fresh",
    check: {}, poster: { children: [], append(child) { this.children.push(child); } },
  };
  const context = {
    items: [item],
    request: async () => { throw new Error("offline"); },
    threadPath: () => "/thread",
    document: { createElement: () => ({}) },
    updateDuplicateHighlights() {}, updateRebloggerOptions() {}, updateTable() {},
  };
  vm.createContext(context);
  vm.runInContext(load, context);
  assert.equal(await context.loadReblog(item, true), "offline");
  assert.equal(item.lastReblog.blog, "author");
  assert.match(item.poster.children[0].textContent, /offline/);
  assert.equal(item.checkState, "done");
  assert.equal(item.check.disabled, false);
});

test("checks saved threads before applying filters and reports hidden or failed checks", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "threads", "threads.js"), "utf8");
  const refresh = source.slice(source.indexOf("async function refresh("), source.indexOf('\nform.addEventListener("submit"'));
  assert.ok(refresh.startsWith("async function refresh("));
  const saved = { blog: "root", postId: "123", title: "bull" };
  for (const scenario of [
    { author: "therapardalis", expected: "Thread saved.", page: 2 },
    { author: "therapardalis", cached: true, expected: "Thread saved.", page: 2 },
    { author: "someone-else", expected: "hidden by the current filters", page: 1 },
    { error: "offline", expected: "Could not update its latest reblog: offline", page: 1 },
    { unverified: true, error: "Tumblr unavailable", expected: "Thread saved without verifying the post with Tumblr.", page: 1 },
  ]) {
    const calls = [];
    const other = { thread: { blog: "root", postId: "456", title: "bull" }, lastReblog: { blog: "therapardalis" } };
    const context = {
      loadingThreads: false, matchingItems: [], items: [], currentPage: 1, ausLoaded: true,
      randomThreadButton: {}, refreshButton: {}, submitButton: {}, askButton: {}, message: {},
      askDialog: { open: false }, askMessage: {}, pageSize: { value: "1" },
      table: { replaceChildren() {}, querySelectorAll: () => [] },
      loadDefaultBlog: async () => {}, loadAsks: async () => {}, loadAus: async () => {},
      request: async (url) => url === "/api/threads" ? [other.thread, saved] : scenario.cached
        ? [{ ...saved, lastReblog: { blog: scenario.author }, cache: { stale: false } }] : [],
      renderThread: (thread) => ({ thread, checkState: "needed", lastReblog: thread === other.thread ? other.lastReblog : null }),
      renderReblog(item, result) { item.lastReblog = result.lastReblog; },
      loadReblog: async (item) => {
        calls.push(item.thread.postId);
        item.lastReblog = scenario.author ? { blog: scenario.author } : null;
        item.checkState = "done";
        return scenario.error || null;
      },
      updatePartnerOptions() {}, updateDuplicateHighlights() {}, updateRebloggerOptions() {},
      updateTable() {
        context.matchingItems = context.items.filter((item) => matches(item, false, "owner", "bull", "therap"));
      },
    };
    vm.createContext(context);
    vm.runInContext(refresh, context);
    assert.equal(await context.refresh(saved, scenario.unverified), true);
    assert.deepEqual(calls, scenario.cached ? [] : ["123"]);
    assert.match(context.message.textContent, new RegExp(scenario.expected.replace(".", "\\.")));
    assert.equal(context.currentPage, scenario.page);
    if (scenario.error) assert.match(context.message.textContent, /hidden by the current filters/);
  }
});

test("confirms a saved thread immediately while tracker reload is pending", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "threads", "threads.js"), "utf8");
  const refresh = source.slice(source.indexOf("async function refresh("), source.indexOf('\nform.addEventListener("submit"'));
  let release;
  const context = {
    randomThreadButton: {}, refreshButton: {}, submitButton: {}, message: {}, ausLoaded: true, matchingItems: [],
    table: { querySelectorAll: () => [] },
    loadDefaultBlog: async () => { await new Promise((resolve) => { release = resolve; }); throw new Error("offline"); },
    updateTable() {},
  };
  vm.createContext(context);
  vm.runInContext(refresh, context);
  const pending = context.refresh({ blog: "root", postId: "123" });
  assert.match(context.message.textContent, /Thread saved.*checking Tumblr/);
  release();
  assert.equal(await pending, false);
  assert.match(context.message.textContent, /Thread saved, but the list could not be reloaded: offline/);
});

test("flags only matching last-reblog timestamps and case-insensitive blog names", () => {
  const first = { lastReblog: { blog: "Author", timestamp: 123 } };
  const same = { lastReblog: { blog: "author", timestamp: 123 } };
  const differentBlog = { lastReblog: { blog: "someone", timestamp: 123 } };
  const differentTime = { lastReblog: { blog: "author", timestamp: 124 } };
  const noReblog = { lastReblog: null, savedPost: { blog: "author", timestamp: 123 } };
  const invalid = { lastReblog: { blog: "author", timestamp: null } };
  const counts = possibleDuplicates([first, same, differentBlog, differentTime, noReblog, invalid]);
  assert.equal(counts.get(first), 2);
  assert.equal(counts.get(same), 2);
  assert.equal(counts.size, 2);
  assert.equal(possibleDuplicates([first]).size, 0);
});

test("groups renamed rebloggers by UUID without conflating reused names", () => {
  const first = { lastReblog: { blog: "old-name", blogUuid: "t:Stable", timestamp: 123 }, cache: { checkedAt: 1 } };
  const renamed = { lastReblog: { blog: "new-name", blogUuid: "t:Stable", timestamp: 123 }, cache: { checkedAt: 2 } };
  const other = { lastReblog: { blog: "new-name", blogUuid: "t:Other", timestamp: 123 } };
  const legacy = { lastReblog: { blog: "new-name", timestamp: 123 } };
  assert.deepEqual(rebloggers([first, renamed, other, legacy]), [
    ["uuid:t:Other", "new-name (t:Other)"], ["uuid:t:Stable", "new-name (t:Stable)"], ["new-name", "new-name (UUID unknown)"],
  ]);
  assert.equal(possibleDuplicates([first, renamed, other, legacy]).size, 2);
  assert.equal(matches(first, false, "owner", "", "", "uuid:t:Stable"), true);
  assert.equal(matches(renamed, false, "owner", "", "", "uuid:t:Stable"), true);
  assert.equal(matches(other, false, "owner", "", "", "uuid:t:Stable"), false);
  assert.equal(matches(legacy, false, "owner", "", "", "uuid:t:Stable"), false);
});

test("updates possible-duplicate labels and highlighting when entries change", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "threads", "threads.js"), "utf8");
  const update = source.slice(source.indexOf("function updateDuplicateHighlights("), source.indexOf("\nfunction updateRebloggerOptions("));
  assert.ok(update.startsWith("function updateDuplicateHighlights("));
  const item = (blog, timestamp) => ({
    lastReblog: { blog, timestamp },
    row: { classList: { toggle(name, active) { this[name] = active; } } },
    duplicateBadge: {},
  });
  const first = item("Author", 123);
  const second = item("author", 123);
  const context = { items: [first, second], ThreadTable: { possibleDuplicates } };
  vm.createContext(context);
  vm.runInContext(update, context);
  context.updateDuplicateHighlights();
  assert.equal(first.row.classList["possible-duplicate"], true);
  assert.equal(first.duplicateBadge.textContent, "Possible duplicate · 2 entries");
  assert.equal(first.duplicateBadge.hidden, false);
  context.items.pop();
  context.updateDuplicateHighlights();
  assert.equal(first.row.classList["possible-duplicate"], false);
  assert.equal(first.duplicateBadge.hidden, true);
});

test("renders a thread row with its merge action", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "threads", "threads.js"), "utf8");
  const render = source.slice(source.indexOf("function renderThread("), source.indexOf("\nfunction updateNotesRemaining("));
  assert.ok(render.startsWith("function renderThread("));
  const element = () => ({
    children: [],
    classList: { toggle(name, enabled) { this[name] = enabled; } },
    append(...children) { this.children.push(...children); },
    prepend(...children) { this.children.unshift(...children); },
    setAttribute() {},
    addEventListener() {},
  });
  const context = {
    document: { createElement: element },
    table: { insertRow: element },
    linkCell: () => element(),
    cell: () => element(),
    auName: () => "—",
    refreshButton: { disabled: false },
    URLSearchParams,
  };
  vm.createContext(context);
  vm.runInContext(render, context);
  const result = context.renderThread({
    title: "w/ partner | story", url: "https://www.tumblr.com/blog/123", blog: "blog", postId: "123",
  });
  assert.equal(result.merge.textContent, "Merge");
  assert.equal(result.merge.hidden, true);
  assert.equal(result.notes.textContent, "Notes");
  assert.equal(result.notes.classList["has-notes"], false);
  const withNotes = context.renderThread({
    title: "Another", url: "https://www.tumblr.com/blog/456", blog: "blog", postId: "456", notes: "A note",
  });
  assert.equal(withNotes.notes.textContent, "Notes saved");
  assert.equal(withNotes.notes.classList["has-notes"], true);
  assert.equal(result.partnerBadge.type, "button");
  assert.equal(result.status, "done");
  assert.equal(result.checkState, "needed");
});

test("notes editor counts characters, saves changes, and keeps failed edits open", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "threads", "threads.js"), "utf8");
  const editor = source.slice(source.indexOf("function updateNotesButton("), source.indexOf("\nfunction showPartnerThreads("));
  const listeners = {};
  const thread = { blog: "root", postId: "123", title: "Synthetic" };
  const item = { thread, notes: {
    classList: { toggle(_name, enabled) { item.notes.highlighted = enabled; } },
    setAttribute(_name, value) { item.notes.accessibleLabel = value; },
  } };
  const context = {
    notesInput: { value: "x".repeat(1000), addEventListener(_type, callback) { listeners.input = callback; } },
    notesCancel: { addEventListener(_type, callback) { listeners.cancel = callback; } },
    notesDialog: { open: true, addEventListener(_type, callback) { listeners.dialogCancel = callback; }, close() { this.open = false; } },
    notesForm: { addEventListener(_type, callback) { listeners.submit = callback; } },
    notesSave: {}, notesRemaining: {}, notesMessage: {}, notesThread: thread,
    notesBlog: "owner", defaultBlog: "owner", items: [item],
    threadPath: () => "/threads/root/123",
    request: async (_url, options) => ({ notes: JSON.parse(options.body).notes }),
  };
  vm.createContext(context);
  vm.runInContext(editor, context);
  listeners.input();
  assert.equal(context.notesRemaining.textContent, "0 characters remaining");
  await listeners.submit({ preventDefault() {} });
  assert.equal(item.thread.notes.length, 1000);
  assert.equal(item.notes.textContent, "Notes saved");
  assert.equal(item.notes.highlighted, true);
  assert.equal(item.notes.accessibleLabel, "Saved notes for Synthetic");
  assert.equal(context.notesDialog.open, false);
  context.notesDialog.open = true;
  context.notesInput.value = "unsaved";
  context.request = async () => { throw new Error("offline"); };
  await listeners.submit({ preventDefault() {} });
  assert.equal(context.notesDialog.open, true);
  assert.equal(context.notesMessage.textContent, "offline");
  assert.equal(item.thread.notes.length, 1000);
  assert.equal(context.notesInput.disabled, false);
  context.request = async () => ({ notes: "" });
  context.notesInput.value = "";
  await listeners.submit({ preventDefault() {} });
  assert.equal(item.notes.textContent, "Notes");
  assert.equal(item.notes.highlighted, false);
  assert.equal(item.notes.accessibleLabel, "Add notes for Synthetic");
});

test("partner details list all matching entries and identify the current post", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "threads", "threads.js"), "utf8");
  const details = source.slice(source.indexOf("function showPartnerThreads("), source.indexOf('\ndocument.querySelector("#partner-dialog-close")'));
  assert.ok(details.startsWith("function showPartnerThreads("));
  const current = { title: "First", partner: "River", partnerNumber: 1, blog: "a", postId: "1", url: "https://www.tumblr.com/a/1" };
  const other = { title: "Second", partner: "river", partnerNumber: 2, blog: "b", postId: "2", url: "https://www.tumblr.com/b/2" };
  const list = { children: [], replaceChildren() { this.children = []; }, append(child) { this.children.push(child); } };
  const dialog = { showModal() { this.open = true; } };
  const summary = {};
  const context = {
    items: [{ thread: other }, { thread: current }, { thread: { partner: "different" } }],
    partnerDialog: dialog, partnerDialogSummary: summary, partnerDialogList: list,
    document: {
      createElement: () => ({ children: [], append(child) { this.children.push(child); } }),
      createTextNode: (text) => ({ textContent: text }),
    },
  };
  vm.createContext(context);
  vm.runInContext(details, context);
  context.showPartnerThreads(current);
  assert.equal(summary.textContent, "2 threads with River.");
  assert.equal(dialog.open, true);
  assert.equal(list.children.length, 2);
  assert.equal(list.children[0].children[0].textContent, "#1 - First");
  assert.equal(list.children[0].children[1].textContent, " (this entry)");
  assert.equal(list.children[1].children[0].textContent, "#2 - Second");
  assert.equal(list.children[1].children[0].href, other.url);
});

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

test("lists known displayed authors and combines exact selection with text searches", () => {
  const entries = [
    { thread: { title: "First" }, lastReblog: { blog: "River" } },
    { thread: { title: "Second" }, lastReblog: { blog: "river" } },
    { thread: { title: "Third" }, lastReblog: null, savedPost: { blog: "Riverton" } },
    { thread: { title: "Loading" } },
  ];
  assert.deepEqual(rebloggers(entries), [["river", "River"], ["riverton", "Riverton"]]);
  assert.deepEqual(entries.filter((item) => matches(item, false, "owner", "", "iv", "RIVER"))
    .map((item) => item.thread.title), ["First", "Second"]);
  assert.equal(matches(entries[2], false, "owner", "", "river", "riverton"), true);
  assert.equal(matches(entries[0], false, "owner", "", "other", "river"), false);
  assert.equal(matches(entries[3], false, "owner", "", "", "river"), false);
  assert.equal(matches(entries[2], true, "owner", "", "", "riverton"), false);
});

test("retains the selected reblogger when results no longer include it", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "threads", "threads.js"), "utf8");
  const update = source.slice(source.indexOf("function updateRebloggerOptions("), source.indexOf("\nfunction auName("));
  assert.ok(update.startsWith("function updateRebloggerOptions("));
  const select = {
    value: "river",
    options: [{ value: "", textContent: "All rebloggers" }, { value: "river", textContent: "River" }],
    replaceChildren(...options) { this.options = options; },
  };
  const context = {
    ThreadTable: { rebloggers },
    rebloggerSelect: select,
    items: [{ status: "loading" }],
    Option: function (name, value) { this.textContent = name; this.value = value; },
  };
  vm.createContext(context);
  vm.runInContext(update, context);
  context.updateRebloggerOptions();
  assert.equal(select.value, "river");
  context.items = [{ status: "done", lastReblog: { blog: "Other" } }];
  context.updateRebloggerOptions();
  assert.equal(select.value, "river");
  assert.deepEqual(select.options.map((option) => option.value), ["", "other", "river"]);
});

test("reset filters clears every filter without changing display preferences", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "threads", "threads.js"), "utf8");
  const reset = source.slice(source.indexOf("function resetFilters("), source.indexOf("\nfunction updateTable("));
  assert.ok(reset.startsWith("function resetFilters("));
  const context = {
    titleFilter: { value: "story" }, partnerFilter: { value: "river" },
    rebloggerFilter: { value: "other" }, rebloggerSelect: { value: "other" },
    auFilter: { value: "unassigned" }, statusFilter: { value: "favourites" },
    otherRebloggers: { checked: true }, favouritesFirst: { checked: true },
    pageSize: { value: "25" }, currentPage: 3, sortKey: "title", calls: 0,
    updateTable() { context.calls++; },
  };
  vm.createContext(context);
  vm.runInContext(reset, context);
  context.resetFilters();
  for (const key of ["titleFilter", "partnerFilter", "rebloggerFilter", "rebloggerSelect", "auFilter"]) {
    assert.equal(context[key].value, "");
  }
  assert.equal(context.statusFilter.value, "all");
  assert.equal(context.otherRebloggers.checked, false);
  assert.equal(context.currentPage, 1);
  assert.equal(context.calls, 1);
  assert.equal(context.favouritesFirst.checked, true);
  assert.equal(context.pageSize.value, "25");
  assert.equal(context.sortKey, "title");
});

test("clearing the entry form restores defaults without clearing table filters", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "threads", "threads.js"), "utf8");
  const reset = source.slice(source.indexOf("function resetForm("), source.indexOf("\nfunction editThread("));
  assert.ok(reset.startsWith("function resetForm("));
  const help = { textContent: "Only digits are allowed" };
  const context = {
    editingThread: {}, originalTitleFields: {}, defaultPostReference: "url",
    referenceType: { value: "id" }, idInput: { value: "123" }, lastValidPostId: "123",
    partnerInput: { value: "partner", required: false },
    blogInput: { value: "other", defaultValue: "owner" },
    submitButton: { textContent: "Save changes" }, clearFormButton: { hidden: true },
    cancelButton: { hidden: false }, unverifiedLinkButton: { hidden: false }, editCompletedField: { hidden: false },
    titleFilter: { value: "search" }, clearedUrl: false, updatedFields: false,
    document: { querySelector: () => help },
    showUnverifiedSavePrompt(show) { context.promptVisible = show; },
    clearExtractUrl() { context.clearedUrl = true; },
    updateReferenceFields() { context.updatedFields = true; },
    form: { reset() { context.idInput.value = ""; context.partnerInput.value = ""; context.blogInput.value = context.blogInput.defaultValue; } },
  };
  vm.createContext(context);
  vm.runInContext(reset, context);
  context.resetForm();
  assert.equal(context.editingThread, null);
  assert.equal(context.referenceType.value, "url");
  assert.equal(context.blogInput.value, "owner");
  assert.equal(context.idInput.value, "");
  assert.equal(context.lastValidPostId, "");
  assert.equal(help.textContent, "Digits only.");
  assert.equal(context.clearedUrl, true);
  assert.equal(context.updatedFields, true);
  assert.equal(context.clearFormButton.hidden, false);
  assert.equal(context.cancelButton.hidden, true);
  assert.equal(context.unverifiedLinkButton.hidden, true);
  assert.equal(context.promptVisible, false);
  assert.equal(context.titleFilter.value, "search");
});

test("unverified fallback prepares a link without saving and validates changed input", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "threads", "threads.js"), "utf8");
  const listener = source.slice(source.indexOf('unverifiedLinkButton.addEventListener("click"'), source.indexOf('\nclearFormButton.addEventListener("click"'));
  const prompt = source.slice(source.indexOf("function showUnverifiedSavePrompt("), source.indexOf("\nfunction resetForm("));
  assert.ok(listener.startsWith('unverifiedLinkButton.addEventListener("click"'));
  let click;
  const context = {
    PostReference: require("../public/threads/postReference"),
    blogInput: { value: "private-blog" }, idInput: { value: "789524026478493696" },
    urlInput: {}, referenceType: { value: "id" }, message: {}, updated: false,
    editingThread: null, unverifiedSaveHelp: {},
    submitButton: { classList: { toggle(_name, enabled) { context.highlighted = enabled; } }, focus() { context.focused = true; } },
    unverifiedLinkButton: { hidden: false, addEventListener(_type, callback) { click = callback; } },
    updateReferenceFields() { context.updated = true; },
  };
  vm.createContext(context);
  vm.runInContext(prompt, context);
  vm.runInContext(listener, context);
  click();
  assert.equal(context.urlInput.value, "https://www.tumblr.com/private-blog/789524026478493696");
  assert.equal(context.referenceType.value, "url");
  assert.equal(context.updated, true);
  assert.match(context.message.textContent, /saved without Tumblr verification/);
  assert.equal(context.unverifiedSaveHelp.hidden, false);
  assert.match(context.unverifiedSaveHelp.textContent, /Not saved yet.*Track thread/);
  assert.equal(context.highlighted, true);
  assert.equal(context.focused, true);
  context.editingThread = {};
  context.showUnverifiedSavePrompt(true, true);
  assert.match(context.unverifiedSaveHelp.textContent, /Step 1 first.*Save changes/);
  context.showUnverifiedSavePrompt(true);
  assert.match(context.unverifiedSaveHelp.textContent, /Save changes/);
  context.showUnverifiedSavePrompt(false);
  assert.equal(context.highlighted, false);
  assert.equal(context.unverifiedSaveHelp.hidden, true);
  context.idInput.value = "invalid";
  context.referenceType.value = "id";
  click();
  assert.equal(context.referenceType.value, "id");
  assert.match(context.message.textContent, /numeric/);
});

test("verification failure highlights the save button with step-one instructions", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "threads", "threads.js"), "utf8");
  const handler = source.slice(source.indexOf('form.addEventListener("submit"'), source.indexOf('\nrefreshButton.addEventListener("click"'));
  const prompt = source.slice(source.indexOf("function showUnverifiedSavePrompt("), source.indexOf("\nfunction resetForm("));
  let submit;
  const values = { partner: "writer", story: "", auId: "", blog: "private", postId: "123" };
  const context = {
    form: { addEventListener(_type, callback) { submit = callback; } },
    FormData: class { get(key) { return values[key]; } },
    table: { querySelectorAll: () => [] }, submitButton: { classList: { toggle(_name, enabled) { context.highlighted = enabled; } } },
    clearFormButton: {}, cancelButton: {}, refreshButton: {}, unverifiedLinkButton: { hidden: true },
    unverifiedSaveHelp: {}, message: {}, editingThread: null, originalTitleFields: null,
    referenceType: { value: "id" }, ausLoaded: true,
    request: async () => { throw Object.assign(new Error("Cannot verify"), { canSaveUnverified: true }); },
  };
  vm.createContext(context);
  vm.runInContext(prompt, context);
  vm.runInContext(handler, context);
  await submit({ preventDefault() {} });
  assert.equal(context.unverifiedLinkButton.hidden, false);
  assert.equal(context.highlighted, true);
  assert.equal(context.unverifiedSaveHelp.hidden, false);
  assert.match(context.unverifiedSaveHelp.textContent, /Step 1 first.*Track thread/);
});

test("paginates filtered results and clamps a page after removals", () => {
  const entries = Array.from({ length: 26 }, (_, index) => index);
  assert.deepEqual(page(entries, 5, 2).items, entries.slice(5, 10));
  assert.deepEqual(page(entries, 5, 6).items, [25]);
  assert.deepEqual(page(entries, 10, 2).items, entries.slice(10, 20));
  assert.deepEqual(page(entries, 25, 2).items, [25]);
  assert.equal(page(entries, 50, 2).current, 1);
  assert.equal(page(entries, 100, 1).items.length, 26);
  assert.deepEqual(page([], 10, 3), { items: [], current: 1, pages: 1, total: 0, start: 0 });
});

test("chooses randomly from all matching results, including other pages", () => {
  const entries = Array.from({ length: 26 }, (_, index) => ({
    thread: { title: `Thread ${index}`, completed: index % 2 === 0 },
  }));
  const matching = entries.filter((item) => matchesStatus(item, "completed"));
  assert.equal(page(matching, 10, 1).items.length, 10);
  assert.equal(random(matching, () => 0), entries[0]);
  assert.equal(random(matching, () => 0.999), entries[24]);
  assert.equal(random([], () => 0), null);
});

test("paginates 25 saved asks in groups of five and clamps after removal", () => {
  const asks = Array.from({ length: 25 }, (_, index) => index + 1);
  const pages = Array.from({ length: 5 }, (_, index) => page(asks, 5, index + 1));
  assert.deepEqual(pages.flatMap((result) => result.items), asks);
  assert.ok(pages.every((result) => result.items.length === 5 && result.pages === 5));
  const afterRemoval = page(asks.slice(0, 20), 5, 5);
  assert.equal(afterRemoval.current, 4);
  assert.deepEqual(afterRemoval.items, [16, 17, 18, 19, 20]);
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

test("starred-first ordering and feedback follow filtered results across pages", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "threads", "threads.js"), "utf8");
  const update = source.slice(source.indexOf("function updateTable("), source.indexOf("\nasync function checkVisible("));
  assert.ok(update.startsWith("function updateTable("));
  const entries = Array.from({ length: 7 }, (_, index) => ({
    thread: { title: index === 6 ? "Starred" : `Ordinary ${index}`, blog: "root", ...(index === 6 ? { favourite: true } : {}) },
    row: { id: index },
  }));
  const rows = [];
  const context = {
    ThreadTable: require("../public/threads/tableState"),
    items: entries, emptyRow: null, sortKey: null, sortDirection: "ascending", loadingThreads: false,
    favouritesFirst: { checked: true }, favouritesFirstHelp: {},
    otherRebloggers: { checked: false }, defaultBlog: "owner", titleFilter: { value: "" },
    rebloggerFilter: { value: "" }, rebloggerSelect: { value: "" },
    statusFilter: { value: "all" }, partnerFilter: { value: "" }, auFilter: { value: "" },
    randomThreadButton: {}, pageSize: { value: "5" }, currentPage: 1,
    firstPage: {}, previousPage: {}, lastPageButton: {}, nextPage: {}, pageStatus: {},
    table: { append(row) { const i = rows.indexOf(row); if (i !== -1) rows.splice(i, 1); rows.push(row); } },
    checkVisible() {},
  };
  vm.createContext(context);
  vm.runInContext(update, context);
  context.updateTable();
  assert.equal(rows[0].id, 6);
  assert.equal(rows[0].hidden, false);
  assert.equal(rows.filter((row) => !row.hidden).length, 5);
  assert.match(context.favouritesFirstHelp.textContent, /1 starred thread shown first/);
  context.titleFilter.value = "ordinary";
  context.updateTable();
  assert.equal(rows[0].hidden, true);
  assert.equal(rows.filter((row) => !row.hidden).length, 5);
  assert.match(context.favouritesFirstHelp.textContent, /No starred threads match/);
  context.favouritesFirst.checked = false;
  context.updateTable();
  assert.equal(context.favouritesFirstHelp.hidden, true);
});
