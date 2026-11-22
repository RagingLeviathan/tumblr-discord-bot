"use strict";

const table = document.querySelector("#threads");
const form = document.querySelector("#add-thread");
const message = document.querySelector("#message");
const refreshButton = document.querySelector("#refresh");
const randomThreadButton = document.querySelector("#random-thread");
const referenceType = form.elements.referenceType;
const blogInput = form.elements.blog;
const idInput = form.elements.postId;
const urlInput = form.elements.url;
const extractUrlInput = form.elements.extractUrl;
const extractUrlHelp = document.querySelector("#extract-url-help");
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
const firstPage = document.querySelector("#first-page");
const previousPage = document.querySelector("#previous-page");
const nextPage = document.querySelector("#next-page");
const lastPageButton = document.querySelector("#last-page");
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
const askButton = document.querySelector("#manage-asks");
const askCountStatus = document.querySelector("#ask-count-status");
const askDialog = document.querySelector("#ask-dialog");
const askForm = document.querySelector("#ask-form");
const askSubmit = askForm.querySelector('button[type="submit"]');
const askMessage = document.querySelector("#ask-message");
const askList = document.querySelector("#ask-list");
const askPagination = document.querySelector("#ask-pagination");
const askFirst = document.querySelector("#ask-first");
const askPrevious = document.querySelector("#ask-previous");
const askNext = document.querySelector("#ask-next");
const askLast = document.querySelector("#ask-last");
const askPageStatus = document.querySelector("#ask-page-status");
let asks = [];
let askRequest = 0;
let askPage = 1;
let askBusy = false;
let trailThread = null;
let trailRequest = 0;
let defaultBlog = null;
let items = [];
let matchingItems = [];
let loadingThreads = true;
let aus = [];
let ausLoaded = false;
let editingAu = null;
let currentPage = 1;
let lastPage = 1;
let sortKey = null;
let sortDirection = "ascending";
let emptyRow = null;
let editingThread = null;
let originalTitleFields = null;
let lastValidPostId = idInput.value;
let defaultPostReference = "id";

function clearExtractUrl() {
  extractUrlInput.value = "";
  extractUrlInput.setCustomValidity("");
  extractUrlHelp.textContent = "Fills the post ID and blog name.";
}

function resetForm() {
  editingThread = null;
  originalTitleFields = null;
  form.reset();
  referenceType.value = defaultPostReference;
  clearExtractUrl();
  lastValidPostId = idInput.value;
  partnerInput.required = true;
  submitButton.textContent = "Track thread";
  cancelButton.hidden = true;
  editCompletedField.hidden = true;
  updateReferenceFields();
}

function editThread(thread) {
  clearExtractUrl();
  editingThread = thread;
  const formatted = /^w\/\s+(.+?)\s+\|\s+(.+)$/i.exec(thread.title);
  partnerInput.value = formatted ? formatted[1] : "";
  storyInput.value = formatted ? formatted[2] : thread.title;
  originalTitleFields = { partner: partnerInput.value, story: storyInput.value };
  partnerInput.required = Boolean(formatted);
  referenceType.value = defaultPostReference;
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
    [document.querySelector("#extract-url-field"), extractUrlInput, isId],
  ]) {
    field.hidden = !active;
    input.disabled = !active;
    input.required = active && input !== extractUrlInput;
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
      askRequest++;
      asks = [];
      askPage = 1;
      askPagination.hidden = true;
      setAskBusy(false);
      askButton.textContent = "Saved asks (?)";
      askList.replaceChildren();
      askForm.reset();
      askMessage.textContent = "";
      if (askDialog.open) askDialog.close();
      resetForm();
      table.replaceChildren();
      items = [];
      emptyRow = null;
    }
    otherRebloggers.disabled = false;
    filterHelp.textContent = `Excludes ${config.defaultBlog} and threads with no known reblogger.`;
    updateTable();
  } catch (error) {
    askButton.disabled = true;
    askButton.textContent = "Saved asks (?)";
    askCountStatus.textContent = "Saved asks are unavailable until the configured blog can be loaded.";
    message.textContent = `Could not load default blog: ${error.message}`;
    filterHelp.textContent = "Filter unavailable: could not load the configured blog.";
    otherRebloggers.disabled = true;
    throw error;
  }
}

function setAskBusy(busy) {
  askBusy = busy;
  askSubmit.disabled = busy;
  askList.querySelectorAll("button").forEach((button) => { button.disabled = busy; });
  const pages = Math.max(1, Math.ceil(asks.length / 5));
  askFirst.disabled = askPrevious.disabled = busy || askPage <= 1;
  askNext.disabled = askLast.disabled = busy || askPage >= pages;
}

function renderAsks() {
  askList.replaceChildren();
  const page = ThreadTable.page(asks, 5, askPage);
  askPage = page.current;
  askPagination.hidden = !page.total;
  askPageStatus.textContent = page.total
    ? `Page ${page.current} of ${page.pages} · ${page.start + 1}–${page.start + page.items.length} of ${page.total}`
    : "";
  setAskBusy(askBusy);
  if (!asks.length) {
    const empty = document.createElement("li");
    empty.textContent = "No saved asks.";
    askList.append(empty);
    return;
  }
  for (const ask of page.items) {
    const row = document.createElement("li");
    const details = document.createElement("div");
    details.className = "ask-details";
    const link = document.createElement("a");
    link.href = ask.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `${ask.blog} / ${ask.postId}`;
    details.append(link);
    if (ask.note) {
      const note = document.createElement("p");
      note.className = "hint";
      note.textContent = ask.note;
      details.append(note);
    }
    for (const action of ["Answered", "Remove"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary";
      button.textContent = action;
      button.disabled = askBusy;
      button.setAttribute("aria-label", `${action} ask ${ask.blog} / ${ask.postId}`);
      button.addEventListener("click", async () => {
        const prompt = action === "Answered"
          ? "Mark this ask answered and remove it from this list? This does not change Tumblr."
          : "Remove this ask from this list? This does not change Tumblr.";
        if (!window.confirm(prompt)) return;
        const blog = defaultBlog;
        askRequest++;
        setAskBusy(true);
        try {
          await request(`/api/threads/asks/${encodeURIComponent(ask.id)}`, { method: "DELETE" });
          if (defaultBlog !== blog) return;
          try {
            await loadAsks();
            askMessage.textContent = action === "Answered" ? "Ask marked answered and removed." : "Ask removed.";
          } catch (error) {
            askMessage.textContent = `Ask removed, but the list could not be reloaded: ${error.message}`;
          }
        } catch (error) {
          if (defaultBlog === blog) askMessage.textContent = error.message;
        } finally {
          if (defaultBlog === blog) {
            setAskBusy(false);
          }
        }
      });
      row.append(button);
    }
    row.prepend(details);
    askList.append(row);
  }
}

async function loadAsks({ showLast = false } = {}) {
  const blog = defaultBlog;
  const current = ++askRequest;
  try {
    const result = await request("/api/threads/asks");
    if (!Array.isArray(result)) throw new Error("The saved ask list is invalid.");
    if (current !== askRequest || blog !== defaultBlog) return;
    asks = result;
    if (showLast) askPage = Math.max(1, Math.ceil(asks.length / 5));
    askButton.textContent = `Saved asks (${asks.length})`;
    askCountStatus.textContent = "";
    renderAsks();
  } catch (error) {
    if (current === askRequest && blog === defaultBlog) {
      asks = [];
      askList.replaceChildren();
      askPagination.hidden = true;
      askButton.textContent = "Saved asks (?)";
      askCountStatus.textContent = `Could not load saved asks: ${error.message}`;
    }
    throw error;
  }
}

askButton.addEventListener("click", async () => {
  askMessage.textContent = "";
  setAskBusy(true);
  askDialog.showModal();
  try {
    await loadAsks();
  } catch (error) {
    askMessage.textContent = error.message;
  } finally {
    setAskBusy(false);
  }
});
askFirst.addEventListener("click", () => { askPage = 1; renderAsks(); });
askPrevious.addEventListener("click", () => { askPage--; renderAsks(); });
askNext.addEventListener("click", () => { askPage++; renderAsks(); });
askLast.addEventListener("click", () => { askPage = Math.max(1, Math.ceil(asks.length / 5)); renderAsks(); });
document.querySelector("#ask-close").addEventListener("click", () => askDialog.close());
askForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const blog = defaultBlog;
  askRequest++;
  setAskBusy(true);
  try {
    await request("/api/threads/asks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: askForm.elements.url.value, note: askForm.elements.note.value }),
    });
    if (defaultBlog !== blog) return;
    askForm.reset();
    try {
      await loadAsks({ showLast: true });
      askMessage.textContent = "Ask saved.";
    } catch (error) {
      askMessage.textContent = `Ask saved, but the list could not be reloaded: ${error.message}`;
    }
  } catch (error) {
    if (defaultBlog === blog) askMessage.textContent = error.message;
  } finally {
    setAskBusy(false);
  }
});

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
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status}).`);
    error.duplicate = data.duplicate;
    throw error;
  }
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
  link.className = "thread-title-link";
  link.textContent = text;
  link.title = text;
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  element.append(link);
  return element;
}

function renderThread(thread) {
  const row = table.insertRow();
  const title = linkCell(row, thread.title, thread.url);
  title.className = "thread-title";
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
  au.className = "au-cell";
  au.title = au.textContent;
  const blog = cell(row, thread.blog);
  blog.className = "blog-cell";
  blog.title = thread.blog;
  const poster = cell(row, "Loading...");
  poster.className = "reblogger-cell";
  const date = cell(row, "—");
  date.className = "date-cell";
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
  for (const item of items) {
    item.au.textContent = auName(item.thread.auId);
    item.au.title = item.au.textContent;
  }
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
  matchingItems = ordered.filter((item) => ThreadTable.matches(item, otherRebloggers.checked, defaultBlog, titleFilter.value, rebloggerFilter.value) &&
    ThreadTable.matchesStatus(item, statusFilter.value) &&
    (!partnerFilter.value || item.thread.partner?.toLowerCase() === partnerFilter.value) &&
    (!auFilter.value || (auFilter.value === "unassigned" ? !item.thread.auId : `au:${item.thread.auId}` === auFilter.value)));
  randomThreadButton.disabled = loadingThreads || !matchingItems.length;
  const page = ThreadTable.page(matchingItems, Number(pageSize.value), currentPage);
  currentPage = page.current;
  lastPage = page.pages;
  const visible = new Set(page.items);
  for (const item of ordered) {
    item.row.hidden = !visible.has(item);
    table.append(item.row);
  }
  pageStatus.textContent = page.total
    ? `Page ${page.current} of ${page.pages} · ${page.start + 1}–${page.start + page.items.length} of ${page.total}`
    : "No matching records";
  firstPage.disabled = previousPage.disabled = page.current === 1;
  lastPageButton.disabled = nextPage.disabled = page.current === page.pages;
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
    const { lastReblog, savedPost, cache } = await request(`${threadPath(item.thread)}/reblog`);
    item.lastReblog = lastReblog;
    item.savedPost = savedPost;
    const latest = lastReblog || savedPost;
    if (!latest) throw new Error("Tumblr returned no saved post details.");
    const name = document.createElement(latest.url ? "a" : "span");
    name.className = "reblogger-name";
    name.textContent = latest.blog;
    name.title = latest.blog;
    if (latest.url) {
      name.href = latest.url;
      name.target = "_blank";
      name.rel = "noopener noreferrer";
    }
    item.poster.replaceChildren(name);
    if (!lastReblog) {
      const label = document.createElement("span");
      label.className = "saved-post-label";
      label.textContent = "Saved post (no reblogs)";
      item.poster.append(label);
    }
    if (cache) {
      const label = document.createElement("span");
      label.className = cache.stale ? "cache-info error" : "cache-info";
      label.textContent = `Checked ${new Date(cache.checkedAt).toLocaleString()}${cache.stale ? ` — ${cache.warning}` : ""}`;
      item.poster.append(label);
    }
    const date = new Date(latest.timestamp * 1000);
    item.date.textContent = Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
    item.date.title = item.date.textContent;
  } catch (error) {
    item.poster.textContent = error.message;
    item.poster.classList.add("error");
  } finally {
    item.status = "done";
    updateTable();
  }
}

async function refresh() {
  loadingThreads = true;
  randomThreadButton.disabled = true;
  refreshButton.disabled = true;
  submitButton.disabled = true;
  message.textContent = "";
  try {
    await loadDefaultBlog();
    askButton.disabled = false;
    try {
      await loadAsks();
    } catch (error) {
      if (askDialog.open) askMessage.textContent = error.message;
    }
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
    loadingThreads = false;
    randomThreadButton.disabled = !matchingItems.length;
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
    if (error.duplicate) {
      const thread = error.duplicate;
      const match = document.createElement("span");
      match.className = "duplicate-match";
      const label = document.createElement("span");
      label.className = "duplicate-match-label";
      label.textContent = "Matching thread";
      const link = document.createElement("a");
      link.className = "duplicate-match-title";
      link.href = thread.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = thread.title;
      const details = [`Blog: ${thread.blog}`, `Post ID: ${thread.postId}`, thread.completed ? "Completed" : "Ongoing"];
      if (thread.auId) details.push(`AU: ${auName(thread.auId)}`);
      if (thread.favourite) details.push("Favourite");
      const badges = document.createElement("span");
      badges.className = "duplicate-match-details";
      for (const detail of details) {
        const badge = document.createElement("span");
        badge.className = "duplicate-match-badge";
        badge.textContent = detail;
        badges.append(badge);
      }
      match.append(label, link, badges);
      message.append(match);
    }
  } finally {
    submitButton.disabled = !ausLoaded;
    cancelButton.disabled = false;
    refreshButton.disabled = false;
    actionButtons.forEach((button) => { button.disabled = false; });
  }
});

refreshButton.addEventListener("click", refresh);
randomThreadButton.addEventListener("click", () => {
  const item = ThreadTable.random(matchingItems);
  if (item) {
    const link = item.poster.querySelector("a.reblogger-name") || item.row.querySelector(".thread-title-link");
    link.click();
  }
});
cancelButton.addEventListener("click", resetForm);
referenceType.addEventListener("change", updateReferenceFields);
form.addEventListener("post-reference-default", (event) => {
  defaultPostReference = event.detail;
  if (!editingThread) {
    referenceType.value = defaultPostReference;
    updateReferenceFields();
  }
});
extractUrlInput.addEventListener("input", () => {
  const value = extractUrlInput.value.trim();
  extractUrlInput.setCustomValidity("");
  if (!value) {
    extractUrlHelp.textContent = "Fills the post ID and blog name.";
    return;
  }
  try {
    const post = PostReference.parsePostUrl(value);
    blogInput.value = post.blog;
    idInput.value = post.postId;
    lastValidPostId = post.postId;
    document.querySelector("#post-id-help").textContent = "Digits only.";
    extractUrlHelp.textContent = "Post ID and blog name filled from the link.";
  } catch (error) {
    if (!(error instanceof PostReference.ValidationError)) throw error;
    extractUrlInput.setCustomValidity(error.message);
    extractUrlHelp.textContent = error.message;
  }
});
blogInput.addEventListener("input", clearExtractUrl);
idInput.addEventListener("input", () => {
  clearExtractUrl();
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
firstPage.addEventListener("click", () => { currentPage = 1; updateTable(); });
previousPage.addEventListener("click", () => { currentPage--; updateTable(); });
nextPage.addEventListener("click", () => { currentPage++; updateTable(); });
lastPageButton.addEventListener("click", () => { currentPage = lastPage; updateTable(); });
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
