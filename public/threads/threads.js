"use strict";

const table = document.querySelector("#threads");
const form = document.querySelector("#add-thread");
const message = document.querySelector("#message");
const refreshButton = document.querySelector("#refresh");
const referenceType = form.elements.referenceType;
const blogInput = form.elements.blog;
const idInput = form.elements.postId;
const urlInput = form.elements.url;
const partnerInput = form.elements.partner;
const storyInput = form.elements.story;
const auInput = form.elements.auId;
const editCompleted = form.elements.completed;
const editCompletedField = document.querySelector("#edit-completed-field");
const titleFilter = document.querySelector("#title-filter");
const partnerFilter = document.querySelector("#partner-filter");
const rebloggerFilter = document.querySelector("#reblogger-filter");
const auFilter = document.querySelector("#au-filter");
const statusFilter = document.querySelector("#status-filter");
const favouritesFirst = document.querySelector("#favourites-first");
const pageSize = document.querySelector("#page-size");
const pageStatus = document.querySelector("#page-status");
const previousPage = document.querySelector("#previous-page");
const nextPage = document.querySelector("#next-page");
const auDialog = document.querySelector("#au-dialog");
const auForm = document.querySelector("#au-form");
const auMessage = document.querySelector("#au-message");
const auList = document.querySelector("#au-list");
const auSubmit = auForm.querySelector('button[type="submit"]');
const auCancelEdit = document.querySelector("#au-cancel-edit");
const submitButton = document.querySelector("#track-thread");
const cancelButton = document.querySelector("#cancel-edit");
const otherRebloggers = document.querySelector("#other-rebloggers");
const filterHelp = document.querySelector("#filter-help");
const sortButtons = Array.from(document.querySelectorAll(".sort"));
const trailDialog = document.querySelector("#trail-dialog");
const trailTitle = document.querySelector("#trail-title");
const trailOpen = document.querySelector("#trail-open");
const trailStatus = document.querySelector("#trail-status");
const trailResults = document.querySelector("#trail-results");
const trailPublic = document.querySelector("#trail-public");
const trailAuthenticated = document.querySelector("#trail-authenticated");
let trailThread = null;
let trailRequest = 0;
let defaultBlog = null;
let items = [];
let aus = [];
let ausLoaded = false;
let editingAu = null;
let currentPage = 1;
let sortKey = null;
let sortDirection = "ascending";
let emptyRow = null;
let editingThread = null;
let originalTitleFields = null;
let lastValidPostId = idInput.value;

function resetForm() {
  editingThread = null;
  originalTitleFields = null;
  form.reset();
  lastValidPostId = idInput.value;
  partnerInput.required = true;
  submitButton.textContent = "Track thread";
  cancelButton.hidden = true;
  editCompletedField.hidden = true;
  updateReferenceFields();
}

function editThread(thread) {
  editingThread = thread;
  const formatted = /^w\/\s+(.+?)\s+\|\s+(.+)$/i.exec(thread.title);
  partnerInput.value = formatted ? formatted[1] : "";
  storyInput.value = formatted ? formatted[2] : thread.title;
  originalTitleFields = { partner: partnerInput.value, story: storyInput.value };
  partnerInput.required = Boolean(formatted);
  referenceType.value = "id";
  urlInput.value = thread.url;
  blogInput.value = thread.blog;
  idInput.value = thread.postId;
  editCompleted.checked = Boolean(thread.completed);
  editCompletedField.hidden = false;
  auInput.value = thread.auId || "";
  if (thread.auId && !auInput.value) {
    auInput.add(new Option("Unknown AU (choose another)", thread.auId));
    auInput.value = thread.auId;
  }
  lastValidPostId = idInput.value;
  submitButton.textContent = "Save changes";
  cancelButton.hidden = false;
  message.textContent = "";
  updateReferenceFields();
  (formatted ? partnerInput : storyInput).focus();
}

function updateReferenceFields() {
  const isId = referenceType.value === "id";
  for (const [field, input, active] of [
    [document.querySelector("#url-field"), urlInput, !isId],
    [document.querySelector("#blog-field"), blogInput, isId],
    [document.querySelector("#id-field"), idInput, isId],
  ]) {
    field.hidden = !active;
    input.disabled = !active;
    input.required = active;
  }
}

async function loadDefaultBlog() {
  try {
    const config = await request("/api/threads/config");
    if (typeof config.defaultBlog !== "string" || !config.defaultBlog.trim()) {
      throw new Error("The configured blog is missing.");
    }
    const newBlog = config.defaultBlog.trim().toLowerCase();
    const changed = defaultBlog !== newBlog;
    defaultBlog = newBlog;
    blogInput.defaultValue = config.defaultBlog;
    if (changed) {
      resetForm();
      table.replaceChildren();
      items = [];
      emptyRow = null;
    }
    otherRebloggers.disabled = false;
    filterHelp.textContent = `Excludes ${config.defaultBlog} and threads with no known reblogger.`;
    updateTable();
  } catch (error) {
    message.textContent = `Could not load default blog: ${error.message}`;
    filterHelp.textContent = "Filter unavailable: could not load the configured blog.";
    otherRebloggers.disabled = true;
    throw error;
  }
}

async function request(url, options) {
  const headers = { ...(options && options.headers) };
  if (defaultBlog && url !== "/api/threads/config") headers["X-Thread-Blog"] = defaultBlog;
  const response = await fetch(url, { ...options, headers });
  if (response.status === 204) return null;
  if (!response.ok && !(response.headers.get("content-type") || "").includes("application/json")) {
    throw new Error(response.status === 404
      ? "Request not found (404). Restart the bot after updating."
      : `Request failed (${response.status}).`);
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function threadPath(thread) {
  return `/api/threads/${encodeURIComponent(thread.blog)}/${encodeURIComponent(thread.postId)}`;
}

function cell(row, value) {
  const element = row.insertCell();
  element.textContent = value;
  return element;
}

function linkCell(row, text, url) {
  const element = cell(row, "");
  const link = document.createElement("a");
  link.textContent = text;
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  element.append(link);
  return element;
}

function renderThread(thread) {
  const row = table.insertRow();
  const title = linkCell(row, thread.title, thread.url);
  const duplicateNotice = document.createElement("span");
  duplicateNotice.className = "sr-only";
  duplicateNotice.textContent = "Shared writing partner. ";
  duplicateNotice.hidden = true;
  title.append(duplicateNotice);
  const controls = document.createElement("span");
  controls.className = "thread-title-controls";
  const completed = document.createElement("input");
  completed.type = "checkbox";
  completed.className = "status-toggle";
  completed.setAttribute("aria-label", `Completed: ${thread.title}`);
  completed.title = "Mark thread as completed";
  const favourite = document.createElement("button");
  favourite.type = "button";
  favourite.className = "favourite-button status-toggle";
  favourite.setAttribute("aria-label", `Favourite: ${thread.title}`);
  controls.append(completed, favourite);
  title.prepend(controls);
  function updateFlags() {
    completed.checked = Boolean(thread.completed);
    favourite.textContent = thread.favourite ? "\u2605" : "\u2606";
    favourite.setAttribute("aria-pressed", String(Boolean(thread.favourite)));
    favourite.title = thread.favourite ? "Remove from favourites" : "Add to favourites";
  }
  updateFlags();
  completed.disabled = refreshButton.disabled;
  favourite.disabled = refreshButton.disabled;
  async function saveFlags(flags) {
    const disabled = Array.from(table.querySelectorAll("button, .status-toggle"), (control) => [control, control.disabled]);
    disabled.forEach(([control]) => { control.disabled = true; });
    const submitWasDisabled = submitButton.disabled;
    submitButton.disabled = true;
    refreshButton.disabled = true;
    message.textContent = "";
    try {
      const saved = await request(`${threadPath(thread)}/status`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(flags),
      });
      thread.completed = Boolean(saved.completed);
      thread.favourite = Boolean(saved.favourite);
      if (editingThread === thread) editCompleted.checked = thread.completed;
    } catch (error) {
      message.textContent = error.message;
    } finally {
      updateFlags();
      disabled.forEach(([control, wasDisabled]) => { control.disabled = wasDisabled; });
      submitButton.disabled = submitWasDisabled;
      refreshButton.disabled = false;
      updateTable();
    }
  }
  completed.addEventListener("change", () => saveFlags({ completed: completed.checked }));
  favourite.addEventListener("click", () => saveFlags({ favourite: !thread.favourite }));
  const au = cell(row, auName(thread.auId));
  cell(row, thread.blog);
  const poster = cell(row, "Loading...");
  const date = cell(row, "—");
  const item = { thread, row, au, poster, date, duplicateNotice, lastReblog: null, status: "loading" };
  const actions = cell(row, "");
  const actionGroup = document.createElement("div");
  actionGroup.className = "row-actions";
  const findTrail = document.createElement("button");
  findTrail.type = "button";
  findTrail.className = "secondary";
  findTrail.textContent = "Find trail";
  findTrail.setAttribute("aria-label", `Find trail for ${thread.title}`);
  findTrail.addEventListener("click", () => {
    trailThread = thread;
    trailTitle.textContent = `Reblog trail: ${thread.title}`;
    trailOpen.href = thread.url;
    trailResults.replaceChildren();
    trailStatus.textContent = "Choose a lookup method, or open the post on Tumblr.";
    trailDialog.showModal();
  });
  const search = document.createElement("a");
  search.href = `https://www.google.com/search?${new URLSearchParams({ q: `site:tumblr.com "${thread.postId}"` })}`;
  search.target = "_blank";
  search.rel = "noopener noreferrer";
  search.className = "search";
  search.textContent = "Search ID";
  search.setAttribute("aria-label", `Search Google for post ID ${thread.postId}`);
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "secondary";
  edit.textContent = "Edit";
  edit.setAttribute("aria-label", `Edit ${thread.title}`);
  edit.addEventListener("click", () => editThread(thread));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove";
  remove.textContent = "Remove";
  remove.setAttribute("aria-label", `Remove ${thread.title}`);
  remove.addEventListener("click", async () => {
    if (!window.confirm(`Stop tracking "${thread.title}"?`)) return;
    remove.disabled = true;
    try {
      await request(threadPath(thread), { method: "DELETE" });
      row.remove();
      items = items.filter((entry) => entry !== item);
      updatePartnerOptions();
      if (editingThread && threadPath(editingThread) === threadPath(thread)) resetForm();
      updateTable();
    } catch (error) {
      message.textContent = error.message;
      remove.disabled = false;
    }
  });
  actionGroup.append(edit, findTrail, search, remove);
  actions.append(actionGroup);
  return item;
}

function updatePartnerOptions() {
  const selected = partnerFilter.value;
  const partners = new Map();
  for (const { thread } of items) {
    if (!thread.partner) continue;
    const key = thread.partner.toLowerCase();
    const entry = partners.get(key);
    if (entry) entry.count++;
    else partners.set(key, { name: thread.partner, count: 1 });
  }
  partnerFilter.replaceChildren(new Option("All writing partners", ""));
  for (const [key, entry] of [...partners.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
    partnerFilter.add(new Option(entry.name, key));
  }
  partnerFilter.value = partners.has(selected) ? selected : "";
  for (const item of items) {
    const duplicate = Boolean(item.thread.partner && partners.get(item.thread.partner.toLowerCase()).count > 1);
    item.row.classList.toggle("duplicate-partner", duplicate);
    item.duplicateNotice.hidden = !duplicate;
  }
}

function auName(id) {
  if (!id) return "—";
  const au = aus.find((entry) => entry.id === id);
  return au ? au.shortName || au.name : "Unknown AU";
}

function updateAuOptions() {
  const selectedAu = auInput.value;
  const selectedFilter = auFilter.value;
  auInput.replaceChildren(new Option("No AU", ""));
  auFilter.replaceChildren(new Option("All AUs", ""), new Option("No AU", "unassigned"));
  for (const au of aus) {
    auInput.add(new Option(au.name, au.id));
    auFilter.add(new Option(au.name, `au:${au.id}`));
  }
  if (selectedAu && !aus.some((au) => au.id === selectedAu)) {
    auInput.add(new Option("Unknown AU (choose another)", selectedAu));
  }
  auInput.value = selectedAu;
  auFilter.value = Array.from(auFilter.options).some((option) => option.value === selectedFilter) ? selectedFilter : "";
  for (const item of items) item.au.textContent = auName(item.thread.auId);
}

async function loadAus() {
  ausLoaded = false;
  const result = await request("/api/threads/aus");
  if (!Array.isArray(result)) throw new Error("The AU list is invalid.");
  aus = result;
  ausLoaded = true;
  updateAuOptions();
}

function renderAus() {
  auList.replaceChildren();
  for (const au of aus) {
    const row = document.createElement("li");
    const details = document.createElement("div");
    details.className = "au-details";
    const name = document.createElement("strong");
    name.textContent = au.name;
    details.append(name);
    if (au.shortName) {
      const shortName = document.createElement("p");
      shortName.className = "hint";
      shortName.textContent = `Short name: ${au.shortName}`;
      details.append(shortName);
    }
    if (au.verseUrl) {
      const link = document.createElement("a");
      link.href = au.verseUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Verse info";
      link.setAttribute("aria-label", `Verse info for ${au.name}`);
      details.append(link);
    }
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "secondary";
    edit.textContent = "Edit";
    edit.setAttribute("aria-label", `Edit AU ${au.name}`);
    edit.addEventListener("click", () => {
      editingAu = au.id;
      auForm.elements.name.value = au.name;
      auForm.elements.shortName.value = au.shortName || "";
      auForm.elements.verseUrl.value = au.verseUrl || "";
      auSubmit.textContent = "Save changes";
      auCancelEdit.hidden = false;
      auMessage.textContent = "";
      auForm.elements.name.focus();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary";
    remove.textContent = "Delete";
    remove.setAttribute("aria-label", `Delete ${au.name}`);
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Delete the AU "${au.name}"?`)) return;
      try {
        await request(`/api/threads/aus/${encodeURIComponent(au.id)}`, { method: "DELETE" });
        await loadAus();
        if (editingAu === au.id) resetAuForm();
        renderAus();
        updateTable();
        auMessage.textContent = "AU deleted.";
      } catch (error) { auMessage.textContent = error.message; }
    });
    row.append(details, edit, remove);
    auList.append(row);
  }
}

function resetAuForm() {
  editingAu = null;
  auForm.reset();
  auSubmit.textContent = "Add AU";
  auCancelEdit.hidden = true;
}

document.querySelector("#manage-aus").addEventListener("click", () => {
  resetAuForm();
  auMessage.textContent = "";
  renderAus();
  auDialog.showModal();
});
document.querySelector("#au-close").addEventListener("click", () => auDialog.close());
auCancelEdit.addEventListener("click", () => {
  resetAuForm();
  auMessage.textContent = "";
});
auForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  auSubmit.disabled = true;
  const isEdit = Boolean(editingAu);
  try {
    await request(isEdit ? `/api/threads/aus/${encodeURIComponent(editingAu)}` : "/api/threads/aus", {
      method: isEdit ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: auForm.elements.name.value,
        shortName: auForm.elements.shortName.value,
        verseUrl: auForm.elements.verseUrl.value,
      }),
    });
    await loadAus();
    resetAuForm();
    renderAus();
    updateTable();
    auMessage.textContent = isEdit ? "AU updated." : "AU added.";
  } catch (error) { auMessage.textContent = error.message; }
  finally { auSubmit.disabled = false; }
});

async function findTrail(mode) {
  const sequence = ++trailRequest;
  const thread = trailThread;
  trailPublic.disabled = true;
  trailAuthenticated.disabled = true;
  trailResults.replaceChildren();
  trailStatus.textContent = "Looking up the trail...";
  try {
    const result = await request(`${threadPath(thread)}/trail?mode=${mode}`);
    if (sequence !== trailRequest) return;
    for (const entry of result.entries) {
      const line = document.createElement("li");
      const name = entry.blog || entry.brokenBlog || (entry.blogUuid ? `Blog UUID ${entry.blogUuid}` : "Unknown blog");
      if (entry.url) {
        const link = document.createElement("a");
        link.href = entry.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = `${name} - post ${entry.postId}`;
        line.append(link);
      } else {
        line.textContent = `${name}${entry.postId ? ` - post ${entry.postId}` : ""} (link unavailable)`;
      }
      trailResults.append(line);
    }
    trailStatus.textContent = result.entries.length
      ? "Available earlier posts, oldest first. Deleted or removed parts may be missing."
      : "No trail entries returned. The post may be original, the trail may be removed, or access may be limited.";
    if (result.parentPostId) trailStatus.textContent += ` Parent post ID: ${result.parentPostId}.`;
  } catch (error) {
    if (sequence === trailRequest) trailStatus.textContent = error.message;
  } finally {
    if (sequence === trailRequest) {
      trailPublic.disabled = false;
      trailAuthenticated.disabled = false;
    }
  }
}

trailPublic.addEventListener("click", () => findTrail("public"));
trailAuthenticated.addEventListener("click", () => findTrail("authenticated"));
document.querySelector("#trail-close").addEventListener("click", () => trailDialog.close());
trailDialog.addEventListener("close", () => {
  trailRequest++;
  trailThread = null;
  trailPublic.disabled = false;
  trailAuthenticated.disabled = false;
});

function updateTable() {
  if (emptyRow) {
    emptyRow.remove();
    emptyRow = null;
  }
  const ordered = ThreadTable.order(items, sortKey, sortDirection, favouritesFirst.checked);
  const matching = ordered.filter((item) => ThreadTable.matches(item, otherRebloggers.checked, defaultBlog, titleFilter.value, rebloggerFilter.value) &&
    ThreadTable.matchesStatus(item, statusFilter.value) &&
    (!partnerFilter.value || item.thread.partner?.toLowerCase() === partnerFilter.value) &&
    (!auFilter.value || (auFilter.value === "unassigned" ? !item.thread.auId : `au:${item.thread.auId}` === auFilter.value)));
  const page = ThreadTable.page(matching, Number(pageSize.value), currentPage);
  currentPage = page.current;
  const visible = new Set(page.items);
  for (const item of ordered) {
    item.row.hidden = !visible.has(item);
    table.append(item.row);
  }
  pageStatus.textContent = page.total
    ? `Page ${page.current} of ${page.pages} · ${page.start + 1}–${page.start + page.items.length} of ${page.total}`
    : "No matching records";
  previousPage.disabled = page.current === 1;
  nextPage.disabled = page.current === page.pages;
  if (!page.total) {
    emptyRow = table.insertRow();
    const loading = items.some((item) => item.status === "loading");
    const text = !items.length ? "No tracked threads yet. Add a Tumblr post above."
      : loading ? "No matching threads yet. Reblogs are still loading."
        : "No threads match the current filter.";
    const empty = cell(emptyRow, text);
    empty.colSpan = 6;
  }
}

async function loadReblog(item) {
  try {
    const { lastReblog, savedPost } = await request(`${threadPath(item.thread)}/reblog`);
    item.lastReblog = lastReblog;
    item.savedPost = savedPost;
    const latest = lastReblog || savedPost;
    if (!latest) throw new Error("Tumblr returned no saved post details.");
    item.poster.textContent = latest.blog;
    if (latest.url) {
      const link = document.createElement("a");
      link.href = latest.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = latest.blog;
      item.poster.replaceChildren(link);
    }
    if (!lastReblog) {
      const label = document.createElement("span");
      label.className = "saved-post-label";
      label.textContent = "Saved post (no reblogs)";
      item.poster.append(label);
    }
    const date = new Date(latest.timestamp * 1000);
    item.date.textContent = Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
  } catch (error) {
    item.poster.textContent = error.message;
    item.poster.className = "error";
  } finally {
    item.status = "done";
    updateTable();
  }
}

async function refresh() {
  refreshButton.disabled = true;
  submitButton.disabled = true;
  message.textContent = "";
  try {
    await loadDefaultBlog();
    await loadAus();
    const threads = await request("/api/threads");
    table.replaceChildren();
    emptyRow = null;
    items = threads.map(renderThread);
    updatePartnerOptions();
    updateTable();
    const pending = [...items];
    async function worker() {
      while (pending.length) await loadReblog(pending.shift());
    }
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
  } catch (error) {
    message.textContent = error.message;
  } finally {
    refreshButton.disabled = false;
    submitButton.disabled = !ausLoaded;
    table.querySelectorAll(".status-toggle").forEach((control) => { control.disabled = false; });
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  cancelButton.disabled = true;
  refreshButton.disabled = true;
  const actionButtons = Array.from(table.querySelectorAll("button, .status-toggle"));
  actionButtons.forEach((button) => { button.disabled = true; });
  message.textContent = "";
  try {
    const fields = new FormData(form);
    const partner = fields.get("partner").trim().replace(/^w\/\s*/i, "");
    const story = fields.get("story").trim() || "n/a";
    if (!partner && !editingThread) {
      throw new Error("Enter a writing partner.");
    }
    const unchanged = originalTitleFields &&
      fields.get("partner") === originalTitleFields.partner &&
      fields.get("story") === originalTitleFields.story;
    const title = unchanged ? editingThread.title : partner ? `w/ ${partner} | ${story}` : story;
    if (title.length > 200) throw new Error("The combined thread title must be 200 characters or fewer.");
    const auId = fields.get("auId") || null;
    const completion = editingThread ? { completed: editCompleted.checked } : {};
    await request(editingThread ? threadPath(editingThread) : "/api/threads", {
      method: editingThread ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(referenceType.value === "id"
        ? { title, auId, ...completion, blog: fields.get("blog").trim(), postId: fields.get("postId").trim() }
        : { title, auId, ...completion, url: fields.get("url") }),
    });
    resetForm();
    await refresh();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submitButton.disabled = !ausLoaded;
    cancelButton.disabled = false;
    refreshButton.disabled = false;
    actionButtons.forEach((button) => { button.disabled = false; });
  }
});

refreshButton.addEventListener("click", refresh);
cancelButton.addEventListener("click", resetForm);
referenceType.addEventListener("change", updateReferenceFields);
idInput.addEventListener("input", () => {
  if (/^[0-9]*$/.test(idInput.value)) {
    lastValidPostId = idInput.value;
    document.querySelector("#post-id-help").textContent = "Digits only.";
  } else {
    const position = idInput.selectionStart;
    idInput.value = lastValidPostId;
    idInput.setSelectionRange(Math.min(position, lastValidPostId.length), Math.min(position, lastValidPostId.length));
    document.querySelector("#post-id-help").textContent = "Only digits are allowed; that input was not added.";
  }
});
for (const filter of [otherRebloggers, auFilter, partnerFilter, statusFilter, favouritesFirst, pageSize]) {
  filter.addEventListener("change", () => { currentPage = 1; updateTable(); });
}
for (const filter of [titleFilter, rebloggerFilter]) {
  filter.addEventListener("input", () => { currentPage = 1; updateTable(); });
}
previousPage.addEventListener("click", () => { currentPage--; updateTable(); });
nextPage.addEventListener("click", () => { currentPage++; updateTable(); });
for (const button of sortButtons) {
  button.addEventListener("click", () => {
    const key = button.dataset.sort;
    sortDirection = sortKey === key && sortDirection === "ascending" ? "descending" : "ascending";
    sortKey = key;
    currentPage = 1;
    for (const headerButton of sortButtons) {
      const selected = headerButton === button;
      headerButton.parentElement.setAttribute("aria-sort", selected ? sortDirection : "none");
      headerButton.querySelector("span").textContent = selected ? (sortDirection === "ascending" ? "▲" : "▼") : "";
    }
    updateTable();
  });
}
document.querySelector("#copyright-year").textContent = new Date().getFullYear();
refresh();
