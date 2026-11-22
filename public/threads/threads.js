"use strict";

const table = document.querySelector("#threads");
const form = document.querySelector("#add-thread");
const message = document.querySelector("#message");
const refreshButton = document.querySelector("#refresh");
const updateIdsButton = document.querySelector("#update-blog-ids");
const cancelIdsButton = document.querySelector("#cancel-blog-ids");
const updateIdsStatus = document.querySelector("#blog-ids-status");
const updateIdsErrors = document.querySelector("#blog-ids-errors");
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
const rebloggerSelect = document.querySelector("#reblogger-select");
const auFilter = document.querySelector("#au-filter");
const statusFilter = document.querySelector("#status-filter");
const favouritesFirst = document.querySelector("#favourites-first");
const favouritesFirstHelp = document.querySelector("#favourites-first-help");
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
const unverifiedSaveHelp = document.querySelector("#unverified-save-help");
const clearFormButton = document.querySelector("#clear-thread-form");
const cancelButton = document.querySelector("#cancel-edit");
const unverifiedLinkButton = document.querySelector("#use-unverified-link");
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
const mergeDialog = document.querySelector("#merge-dialog");
const mergeDescription = document.querySelector("#merge-description");
const mergeForm = document.querySelector("#merge-form");
const mergeWith = document.querySelector("#merge-with");
const mergePrimary = document.querySelector("#merge-primary");
const mergeMessage = document.querySelector("#merge-message");
const mergeCancel = document.querySelector("#merge-cancel");
const partnerDialog = document.querySelector("#partner-dialog");
const partnerDialogSummary = document.querySelector("#partner-dialog-summary");
const partnerDialogList = document.querySelector("#partner-dialog-list");
const notesDialog = document.querySelector("#notes-dialog");
const notesTitle = document.querySelector("#notes-thread-title");
const notesForm = document.querySelector("#notes-form");
const notesInput = document.querySelector("#notes-input");
const notesRemaining = document.querySelector("#notes-remaining");
const notesMessage = document.querySelector("#notes-message");
const notesCancel = document.querySelector("#notes-cancel");
const notesSave = notesForm.querySelector('button[type="submit"]');
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
let mergeThread = null;
let visibleItems = [];
let checkingVisible = false;
let cancelIds = false;
let notesThread = null;
let notesBlog = null;

function clearExtractUrl() {
  extractUrlInput.value = "";
  extractUrlInput.setCustomValidity("");
  extractUrlHelp.textContent = "Fills the post ID and blog name.";
}

function showUnverifiedSavePrompt(show, chooseLinkFirst = false) {
  submitButton.classList.toggle("needs-confirmation", show);
  unverifiedSaveHelp.hidden = !show;
  const action = editingThread ? "Save changes" : "Track thread";
  unverifiedSaveHelp.textContent = !show ? "" : chooseLinkFirst
    ? `Not saved yet. Select Step 1 first, then press ${action}.`
    : `Step 2: Not saved yet. Check the link, then press ${action}.`;
}

function resetForm() {
  unverifiedLinkButton.hidden = true;
  showUnverifiedSavePrompt(false);
  editingThread = null;
  originalTitleFields = null;
  form.reset();
  referenceType.value = defaultPostReference;
  clearExtractUrl();
  document.querySelector("#post-id-help").textContent = "Digits only.";
  lastValidPostId = idInput.value;
  partnerInput.required = true;
  submitButton.textContent = "Track thread";
  clearFormButton.hidden = false;
  cancelButton.hidden = true;
  editCompletedField.hidden = true;
  updateReferenceFields();
}

function editThread(thread) {
  unverifiedLinkButton.hidden = true;
  showUnverifiedSavePrompt(false);
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
  clearFormButton.hidden = true;
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
    error.status = response.status;
    error.canSaveUnverified = data.canSaveUnverified === true;
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
  const title = linkCell(row, thread.title, thread.resolvedBlog
    ? PostReference.postFromId(thread.resolvedBlog, thread.postId).url : thread.url);
  title.className = "thread-title";
  const duplicateNotice = document.createElement("span");
  duplicateNotice.className = "sr-only";
  duplicateNotice.textContent = "Threads share a writing partner. ";
  duplicateNotice.hidden = true;
  title.append(duplicateNotice);
  const partnerBadge = document.createElement("button");
  partnerBadge.type = "button";
  partnerBadge.className = "thread-partner-badge";
  partnerBadge.hidden = true;
  partnerBadge.addEventListener("click", () => showPartnerThreads(thread));
  title.append(partnerBadge);
  const duplicateBadge = document.createElement("span");
  duplicateBadge.className = "possible-duplicate-badge";
  duplicateBadge.hidden = true;
  duplicateBadge.title = "These entries share a last-reblog timestamp and reblogger UUID (or name if both UUIDs are unknown); they may be different posts.";
  title.append(duplicateBadge);
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
  const poster = cell(row, "Not checked");
  poster.className = "reblogger-cell";
  const date = cell(row, "—");
  date.className = "date-cell";
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
    trailOpen.href = thread.resolvedBlog ? PostReference.postFromId(thread.resolvedBlog, thread.postId).url : thread.url;
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
  const notes = document.createElement("button");
  notes.type = "button";
  notes.className = "secondary";
  updateNotesButton(notes, thread);
  notes.addEventListener("click", () => {
    notesThread = thread;
    notesBlog = defaultBlog;
    notesTitle.textContent = thread.title;
    notesInput.value = thread.notes || "";
    updateNotesRemaining();
    notesMessage.textContent = "";
    notesDialog.showModal();
    notesInput.focus();
  });
  const merge = document.createElement("button");
  merge.type = "button";
  merge.className = "secondary";
  merge.textContent = "Merge";
  merge.setAttribute("aria-label", `Merge ${thread.title} with another thread`);
  merge.hidden = true;
  merge.addEventListener("click", () => openMergeDialog(thread));
  const check = document.createElement("button");
  check.type = "button";
  check.className = "secondary";
  check.textContent = "Check";
  check.setAttribute("aria-label", `Check latest reblog for ${thread.title}`);
  const item = { thread, row, au, poster, date, duplicateNotice, partnerBadge, duplicateBadge, merge, check, notes, lastReblog: null, status: "done", checkState: "needed" };
  check.addEventListener("click", () => loadReblog(item, true));
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
      updateDuplicateHighlights();
      updateRebloggerOptions();
      if (editingThread && threadPath(editingThread) === threadPath(thread)) resetForm();
      updateTable();
    } catch (error) {
      message.textContent = error.message;
      remove.disabled = false;
    }
  });
  actionGroup.append(edit, notes, findTrail, search, merge, check, remove);
  actions.append(actionGroup);
  return item;
}

function updateNotesButton(button, thread) {
  const hasNotes = Boolean(thread.notes);
  button.classList.toggle("has-notes", hasNotes);
  button.textContent = hasNotes ? "Notes saved" : "Notes";
  button.title = hasNotes ? "View or edit saved notes" : "Add notes";
  button.setAttribute("aria-label", `${hasNotes ? "Saved notes" : "Add notes"} for ${thread.title}`);
}

function updateNotesRemaining() {
  notesRemaining.textContent = `${1000 - notesInput.value.length} characters remaining`;
}

notesInput.addEventListener("input", updateNotesRemaining);
notesCancel.addEventListener("click", () => notesDialog.close());
notesDialog.addEventListener("cancel", (event) => {
  if (notesSave.disabled) event.preventDefault();
});
notesForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!notesThread || !notesBlog || notesBlog !== defaultBlog) {
    notesMessage.textContent = "The configured blog changed. Refresh the thread list before saving notes.";
    return;
  }
  const thread = notesThread;
  const blog = notesBlog;
  notesSave.disabled = true;
  notesCancel.disabled = true;
  notesInput.disabled = true;
  notesMessage.textContent = "";
  try {
    const saved = await request(`${threadPath(thread)}/notes`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: notesInput.value }),
    });
    if (blog !== defaultBlog) {
      notesMessage.textContent = "Notes were saved in the previous collection. Refresh the thread list.";
      return;
    }
    const item = items.find((entry) => entry.thread.blog === thread.blog && entry.thread.postId === thread.postId);
    if (item) {
      if (saved.notes) item.thread.notes = saved.notes;
      else delete item.thread.notes;
      updateNotesButton(item.notes, item.thread);
    }
    notesDialog.close();
  } catch (error) {
    notesMessage.textContent = error.message;
  } finally {
    notesSave.disabled = false;
    notesCancel.disabled = false;
    notesInput.disabled = false;
  }
});

function showPartnerThreads(thread) {
  const matches = items.map((item) => item.thread)
    .filter((entry) => entry.partner && entry.partner.toLowerCase() === thread.partner.toLowerCase())
    .sort((a, b) => (a.partnerNumber || 0) - (b.partnerNumber || 0));
  partnerDialogSummary.textContent = `${matches.length} threads with ${thread.partner}.`;
  partnerDialogList.replaceChildren();
  for (const entry of matches) {
    const row = document.createElement("li");
    const link = document.createElement("a");
    link.href = entry.resolvedBlog ? PostReference.postFromId(entry.resolvedBlog, entry.postId).url : entry.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `${entry.partnerNumber ? `#${entry.partnerNumber} - ` : ""}${entry.title}`;
    row.append(link);
    if (entry.blog === thread.blog && entry.postId === thread.postId) {
      row.append(document.createTextNode(" (this entry)"));
    }
    partnerDialogList.append(row);
  }
  partnerDialog.showModal();
}

document.querySelector("#partner-dialog-close").addEventListener("click", () => partnerDialog.close());
partnerDialog.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    partnerDialog.close();
  }
});

function openMergeDialog(thread) {
  const candidates = items
    .map((item) => item.thread)
    .filter((candidate) =>
      candidate.partner &&
      thread.partner &&
      candidate.partner.toLowerCase() === thread.partner.toLowerCase() &&
      (candidate.blog !== thread.blog || candidate.postId !== thread.postId));
  if (!candidates.length) {
    message.textContent = "This thread has no other entry with the same writing partner.";
    return;
  }
  mergeThread = thread;
  mergeDescription.textContent = `Choose one entry from the same writing partner, "${thread.partner}", to merge with "${thread.title}".`;
  mergeMessage.textContent = "";
  mergeWith.replaceChildren();
  mergePrimary.replaceChildren();
  for (const candidate of candidates) {
    mergeWith.add(new Option(`${candidate.title} (${candidate.blog}/${candidate.postId})`, `${candidate.blog}/${candidate.postId}`));
  }
  mergeWith.value = `${candidates[0].blog}/${candidates[0].postId}`;
  updateMergePrimary();
  mergeDialog.showModal();
}

function updateMergePrimary() {
  const candidateKey = mergeWith.value;
  const candidate = items.map((item) => item.thread).find((thread) =>
    `${thread.blog}/${thread.postId}` === candidateKey);
  mergePrimary.replaceChildren();
  if (mergeThread) {
    mergePrimary.add(new Option(`${mergeThread.title} (${mergeThread.blog}/${mergeThread.postId})`, `${mergeThread.blog}/${mergeThread.postId}`));
  }
  if (candidate) {
    mergePrimary.add(new Option(`${candidate.title} (${candidate.blog}/${candidate.postId})`, `${candidate.blog}/${candidate.postId}`));
  }
  mergePrimary.value = `${mergeThread.blog}/${mergeThread.postId}`;
}

mergeWith.addEventListener("change", updateMergePrimary);
mergeCancel.addEventListener("click", () => mergeDialog.close());
mergeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!mergeThread) return;
  const candidateKey = mergeWith.value;
  const candidate = items.map((item) => item.thread).find((thread) =>
    `${thread.blog}/${thread.postId}` === candidateKey);
  if (!candidate) return;
  const [keepBlog, keepPostId] = mergePrimary.value.split("/");
  const removeThread = `${mergeThread.blog}/${mergeThread.postId}` === `${keepBlog}/${keepPostId}`
    ? candidate
    : mergeThread;
  const keepThread = `${mergeThread.blog}/${mergeThread.postId}` === `${keepBlog}/${keepPostId}`
    ? mergeThread
    : candidate;
  if (!window.confirm(`Merge "${removeThread.title}" into "${keepThread.title}"? The other entry will be removed.`)) return;
  mergeForm.querySelector('button[type="submit"]').disabled = true;
  mergeCancel.disabled = true;
  mergeMessage.textContent = "";
  try {
    await request(`${threadPath(removeThread)}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keepBlog: keepThread.blog, keepPostId: keepThread.postId }),
    });
    mergeDialog.close();
    await refresh();
  } catch (error) {
    mergeMessage.textContent = error.message;
  } finally {
    mergeForm.querySelector('button[type="submit"]').disabled = false;
    mergeCancel.disabled = false;
  }
});

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
    const count = item.thread.partner ? partners.get(item.thread.partner.toLowerCase()).count : 0;
    const sharedPartner = count > 1;
    item.duplicateNotice.hidden = !sharedPartner;
    item.partnerBadge.hidden = !sharedPartner;
    item.merge.hidden = !sharedPartner;
    if (sharedPartner) {
      const number = item.thread.partnerNumber ? ` · #${item.thread.partnerNumber}` : "";
      item.partnerBadge.textContent = `${count} threads${number}`;
      item.partnerBadge.setAttribute("aria-label", `${count} threads with ${item.thread.partner}${number}. Show details.`);
      item.duplicateNotice.textContent = `${count} threads share the writing partner ${item.thread.partner}. Partner numbers distinguish separate entries. `;
    }
  }
}

function updateDuplicateHighlights() {
  const counts = ThreadTable.possibleDuplicates(items);
  for (const item of items) {
    const count = counts.get(item);
    item.row.classList.toggle("possible-duplicate", Boolean(count));
    item.duplicateBadge.hidden = !count;
    if (count) item.duplicateBadge.textContent = `Possible duplicate · ${count} entries`;
  }
}

function updateRebloggerOptions() {
  const selected = rebloggerSelect.value;
  const names = ThreadTable.rebloggers(items);
  if (selected && !names.some(([key]) => key === selected)) {
    const option = Array.from(rebloggerSelect.options).find((entry) => entry.value === selected);
    names.push([selected, option ? option.textContent : selected]);
    names.sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: "base" }));
  }
  const current = Array.from(rebloggerSelect.options, (option) => [option.value, option.textContent]);
  const desired = [["", "All rebloggers"], ...names];
  if (JSON.stringify(current) !== JSON.stringify(desired)) {
    rebloggerSelect.replaceChildren(...desired.map(([value, name]) => new Option(name, value)));
  }
  rebloggerSelect.value = names.some(([key]) => key === selected) ? selected : "";
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

function resetFilters() {
  titleFilter.value = "";
  partnerFilter.value = "";
  rebloggerFilter.value = "";
  rebloggerSelect.value = "";
  auFilter.value = "";
  statusFilter.value = "all";
  otherRebloggers.checked = false;
  currentPage = 1;
  updateTable();
}

function updateTable() {
  if (emptyRow) {
    emptyRow.remove();
    emptyRow = null;
  }
  const ordered = ThreadTable.order(items, sortKey, sortDirection, favouritesFirst.checked);
  matchingItems = ordered.filter((item) => ThreadTable.matches(item, otherRebloggers.checked, defaultBlog, titleFilter.value, rebloggerFilter.value, rebloggerSelect.value) &&
    ThreadTable.matchesStatus(item, statusFilter.value) &&
    (!partnerFilter.value || item.thread.partner?.toLowerCase() === partnerFilter.value) &&
    (!auFilter.value || (auFilter.value === "unassigned" ? !item.thread.auId : `au:${item.thread.auId}` === auFilter.value)));
  favouritesFirstHelp.hidden = !favouritesFirst.checked;
  if (favouritesFirst.checked) {
    const count = matchingItems.filter((item) => item.thread.favourite).length;
    favouritesFirstHelp.textContent = count
      ? `${count} starred ${count === 1 ? "thread" : "threads"} shown first; other matching threads follow.`
      : "No starred threads match the current filters. Select a star beside a thread or adjust the filters.";
  }
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
  visibleItems = page.items;
  checkVisible();
}

async function checkVisible() {
  if (loadingThreads || checkingVisible) return;
  checkingVisible = true;
  try {
    while (!loadingThreads) {
      const item = visibleItems.find((entry) => entry.checkState === "needed" ||
        (entry.checkState === "fresh" && (Date.now() < entry.cache.checkedAt || Date.now() >= entry.cache.freshUntil)));
      if (!item) break;
      await loadReblog(item);
    }
  } finally {
    checkingVisible = false;
  }
}

function renderReblog(item, { lastReblog, savedPost, cache }) {
  const latest = lastReblog || savedPost;
  if (!latest) throw new Error("Tumblr returned no saved post details.");
  item.lastReblog = lastReblog;
  item.savedPost = savedPost;
  item.cache = cache;
  item.poster.classList.remove("error");
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
  const formatted = ThreadTable.formatPostDate(latest.timestamp);
  if (formatted) {
    const time = document.createElement("span");
    time.className = "post-time";
    time.textContent = formatted.time;
    item.date.replaceChildren(document.createTextNode(formatted.date), time);
    item.date.title = new Date(latest.timestamp * 1000).toLocaleString();
  } else {
    item.date.textContent = "Unknown date";
    item.date.title = "Unknown date";
  }
}

async function loadReblog(item, force = false) {
  if (item.checkState === "checking") return;
  item.checkState = "checking";
  item.check.disabled = true;
  item.status = "loading";
  if (!item.lastReblog && !item.savedPost) item.poster.textContent = "Checking...";
  let result;
  let checkError;
  try {
    result = await request(`${threadPath(item.thread)}/reblog${force ? "?force=1" : ""}`);
    if (items.includes(item)) renderReblog(item, result);
  } catch (error) {
    checkError = error.message;
    if (items.includes(item)) {
      if (item.lastReblog || item.savedPost) {
        const label = document.createElement("span");
        label.className = "cache-info error";
        label.textContent = `Could not check: ${error.message}`;
        item.poster.append(label);
      } else {
        item.poster.textContent = error.message;
        item.poster.classList.add("error");
      }
    }
  } finally {
    item.status = "done";
    item.checkState = result?.cache && !result.cache.stale ? "fresh" : "done";
    item.check.disabled = false;
    if (items.includes(item)) {
      updateDuplicateHighlights();
      updateRebloggerOptions();
      updateTable();
    }
  }
  return checkError || (result?.cache?.stale ? result.cache.warning : null);
}

async function refresh(savedThread = null, unverified = false) {
  loadingThreads = true;
  randomThreadButton.disabled = true;
  refreshButton.disabled = true;
  submitButton.disabled = true;
  message.textContent = savedThread ? "Thread saved. Loading the tracker and checking Tumblr..." : "";
  try {
    await loadDefaultBlog();
    askButton.disabled = false;
    try {
      await loadAsks();
    } catch (error) {
      if (askDialog.open) askMessage.textContent = error.message;
    }
    await loadAus();
    const [threads, cached] = await Promise.all([request("/api/threads"), request("/api/threads/reblogs/cache")]);
    table.replaceChildren();
    emptyRow = null;
    items = threads.map(renderThread);
    const cacheByPost = new Map(cached.map((entry) => [`${entry.blog}/${entry.postId}`, entry]));
    for (const item of items) {
      const result = cacheByPost.get(`${item.thread.blog}/${item.thread.postId}`);
      if (result) {
        renderReblog(item, result);
        item.checkState = result.cache.stale ? "needed" : "fresh";
      }
    }
    const savedItem = savedThread && items.find((item) =>
      item.thread.blog === savedThread.blog && item.thread.postId === savedThread.postId);
    if (savedThread && !savedItem) throw new Error("Saved thread was not found in the reloaded collection.");
    const checkError = savedItem && savedItem.checkState === "needed" ? await loadReblog(savedItem) : null;
    updatePartnerOptions();
    updateDuplicateHighlights();
    updateRebloggerOptions();
    updateTable();
    if (savedItem) {
      const index = matchingItems.indexOf(savedItem);
      if (index >= 0) {
        currentPage = Math.floor(index / Number(pageSize.value)) + 1;
        updateTable();
      }
      const visibility = index < 0 ? " It is hidden by the current filters; clear them to find it." : "";
      const warning = checkError ? ` Could not update its latest reblog: ${checkError}${/[.!?]$/.test(checkError) ? "" : "."}` : "";
      message.textContent = `${unverified ? "Thread saved without verifying the post with Tumblr." : "Thread saved."}${warning}${visibility}`;
    }
    return true;
  } catch (error) {
    message.textContent = `${savedThread ? "Thread saved, but the list could not be reloaded: " : ""}${error.message}`;
    return false;
  } finally {
    loadingThreads = false;
    randomThreadButton.disabled = !matchingItems.length;
    refreshButton.disabled = false;
    submitButton.disabled = !ausLoaded;
    table.querySelectorAll(".status-toggle").forEach((control) => { control.disabled = false; });
    updateTable();
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  clearFormButton.disabled = true;
  cancelButton.disabled = true;
  refreshButton.disabled = true;
  const actionButtons = Array.from(table.querySelectorAll("button, .status-toggle"));
  actionButtons.forEach((button) => { button.disabled = true; });
  message.textContent = "";
  if (!unverifiedLinkButton.hidden) showUnverifiedSavePrompt(false);
  unverifiedLinkButton.hidden = true;
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
    const unverified = referenceType.value === "url";
    const savedThread = await request(editingThread ? threadPath(editingThread) : "/api/threads", {
      method: editingThread ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(referenceType.value === "id"
        ? { title, auId, ...completion, blog: fields.get("blog").trim(), postId: fields.get("postId").trim() }
        : { title, auId, ...completion, url: fields.get("url") }),
    });
    resetForm();
    await refresh(savedThread, unverified);
  } catch (error) {
    message.textContent = error.message;
    if (error.canSaveUnverified && referenceType.value === "id") {
      unverifiedLinkButton.hidden = false;
      showUnverifiedSavePrompt(true, true);
      message.textContent += " Not saved yet. To save the link anyway, select Step 1, then press the highlighted save button. Tumblr details may remain unavailable.";
    }
    if (error.duplicate) {
      const thread = error.duplicate;
      const match = document.createElement("span");
      match.className = "duplicate-match";
      const label = document.createElement("span");
      label.className = "duplicate-match-label";
      label.textContent = "Matching thread";
      const link = document.createElement("a");
      link.className = "duplicate-match-title";
      link.href = thread.resolvedBlog ? PostReference.postFromId(thread.resolvedBlog, thread.postId).url : thread.url;
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
    clearFormButton.disabled = false;
    cancelButton.disabled = false;
    refreshButton.disabled = false;
    actionButtons.forEach((button) => { button.disabled = false; });
  }
});

refreshButton.addEventListener("click", () => refresh());
cancelIdsButton.addEventListener("click", () => { cancelIds = true; });
updateIdsButton.addEventListener("click", async () => {
  if (!items.length) {
    updateIdsStatus.textContent = "There are no tracked threads to update.";
    return;
  }
  if (!window.confirm(`Verify blog identities for ${items.length} tracked threads? This makes paced Tumblr requests and may take several minutes.`)) return;
  const blog = defaultBlog;
  const pending = [...items];
  let processed = 0;
  let failures = 0;
  let stopped = "";
  cancelIds = false;
  updateIdsButton.disabled = true;
  cancelIdsButton.hidden = false;
  updateIdsErrors.replaceChildren();
  try {
    for (const item of pending) {
      if (cancelIds) { stopped = "Stopped by user."; break; }
      if (blog !== defaultBlog) { stopped = "Configured blog changed; refresh before retrying."; break; }
      if (!items.includes(item)) { stopped = "Thread list changed; refresh before retrying."; break; }
      updateIdsStatus.textContent = `Updating ${processed + 1} of ${pending.length}: ${item.thread.title}`;
      try {
        const updated = await request(`${threadPath(item.thread)}/identity`, { method: "POST" });
        if (blog !== defaultBlog) { stopped = "Configured blog changed; refresh before retrying."; break; }
        if (!items.includes(item)) { stopped = "Thread list changed; refresh before retrying."; break; }
        Object.assign(item.thread, updated);
        const titleLink = item.row.querySelector(".thread-title-link");
        titleLink.href = PostReference.postFromId(updated.resolvedBlog, updated.postId).url;
        if (cancelIds) { stopped = "Stopped by user."; break; }
        if ((!item.lastReblog && !item.savedPost) || (item.lastReblog && !item.lastReblog.blogUuid)) {
          const result = await request(`${threadPath(item.thread)}/reblog?force=1`);
          if (result.cache?.rateLimited) {
            const error = new Error(result.cache.warning);
            error.status = 429;
            throw error;
          }
          if (result.cache?.stale) throw new Error(result.cache.warning);
          if (items.includes(item)) {
            renderReblog(item, result);
            item.checkState = "fresh";
            updateDuplicateHighlights();
            updateRebloggerOptions();
            updateTable();
          }
          if (result.lastReblog && !result.lastReblog.blogUuid) {
            throw new Error("Tumblr did not provide the reblogger UUID.");
          }
        }
      } catch (error) {
        failures++;
        const entry = document.createElement("li");
        entry.textContent = `${item.thread.title} (${item.thread.blog}/${item.thread.postId}): ${error.message}`;
        updateIdsErrors.append(entry);
        if (error.status === 429) stopped = "Tumblr rate limit reached; retry after the cooldown.";
        else if (error.status === 409) stopped = "Collection changed; refresh before retrying.";
      }
      processed++;
      if (stopped) break;
    }
  } finally {
    updateIdsButton.disabled = false;
    cancelIdsButton.hidden = true;
    updateIdsStatus.textContent = `Checked ${processed} of ${pending.length} threads; ${failures} need review.${stopped ? ` ${stopped}` : ""}`;
  }
});
randomThreadButton.addEventListener("click", () => {
  const item = ThreadTable.random(matchingItems);
  if (item) {
    const link = item.poster.querySelector("a.reblogger-name") || item.row.querySelector(".thread-title-link");
    link.click();
  }
});
cancelButton.addEventListener("click", resetForm);
unverifiedLinkButton.addEventListener("click", () => {
  try {
    urlInput.value = PostReference.postFromId(blogInput.value, idInput.value).url;
    referenceType.value = "url";
    updateReferenceFields();
    unverifiedLinkButton.hidden = true;
    message.textContent = "Post link ready. It will be saved without Tumblr verification.";
    showUnverifiedSavePrompt(true);
    submitButton.focus();
  } catch (error) {
    if (!(error instanceof PostReference.ValidationError)) throw error;
    unverifiedLinkButton.hidden = true;
    showUnverifiedSavePrompt(false);
    message.textContent = error.message;
  }
});
clearFormButton.addEventListener("click", () => {
  resetForm();
  message.textContent = "";
});
referenceType.addEventListener("change", () => {
  unverifiedLinkButton.hidden = true;
  showUnverifiedSavePrompt(false);
  updateReferenceFields();
});
form.addEventListener("post-reference-default", (event) => {
  defaultPostReference = event.detail;
  if (!editingThread) {
    referenceType.value = defaultPostReference;
    unverifiedLinkButton.hidden = true;
    showUnverifiedSavePrompt(false);
    updateReferenceFields();
  }
});
extractUrlInput.addEventListener("input", () => {
  if (!unverifiedLinkButton.hidden) showUnverifiedSavePrompt(false);
  unverifiedLinkButton.hidden = true;
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
blogInput.addEventListener("input", () => {
  if (!unverifiedLinkButton.hidden) showUnverifiedSavePrompt(false);
  unverifiedLinkButton.hidden = true;
  clearExtractUrl();
});
idInput.addEventListener("input", () => {
  if (!unverifiedLinkButton.hidden) showUnverifiedSavePrompt(false);
  unverifiedLinkButton.hidden = true;
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
for (const filter of [otherRebloggers, auFilter, partnerFilter, rebloggerSelect, statusFilter, favouritesFirst, pageSize]) {
  filter.addEventListener("change", () => { currentPage = 1; updateTable(); });
}
for (const filter of [titleFilter, rebloggerFilter]) {
  filter.addEventListener("input", () => { currentPage = 1; updateTable(); });
}
document.querySelector("#reset-filters").addEventListener("click", resetFilters);
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
