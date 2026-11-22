"use strict";

const TrackerSettings = (() => {
  const key = "tumblr-thread-tracker-settings-v1";
  const maxImageBytes = 2 * 1024 * 1024;
  const defaults = Object.freeze({
    showImage: true, image: null, accent: "blue", textSize: "normal",
    density: "comfortable", partnerHighlights: true, pageSize: "10", postReference: "id",
  });

  function parse(raw) {
    if (raw === null) return { ...defaults };
    const value = JSON.parse(raw);
    const postReference = value?.postReference === undefined ? defaults.postReference : value.postReference;
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        typeof value.showImage !== "boolean" || typeof value.partnerHighlights !== "boolean" ||
        !["blue", "teal", "purple", "rose"].includes(value.accent) ||
        !["normal", "large", "larger"].includes(value.textSize) ||
        !["comfortable", "compact", "spacious"].includes(value.density) ||
        !["5", "10", "25", "50", "100"].includes(value.pageSize) ||
        !["id", "url"].includes(postReference) ||
        !(value.image === null || (typeof value.image === "string" &&
          value.image.length <= Math.ceil(maxImageBytes * 4 / 3) + 64 &&
          /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/]+={0,2}$/i.test(value.image)))) {
      throw new Error("Saved settings are invalid.");
    }
    return { ...value, postReference };
  }

  return { key, maxImageBytes, defaults, parse };
})();

if (typeof module !== "undefined") module.exports = TrackerSettings;

if (typeof document !== "undefined") {
  const settingsDialog = document.querySelector("#settings-dialog");
  const settingsForm = document.querySelector("#settings-form");
  const settingsMessage = document.querySelector("#settings-message");
  const settingsWarning = document.querySelector("#settings-warning");
  const imageStatus = document.querySelector("#settings-image-status");
  const art = document.querySelector(".heading-art");
  const defaultImage = art.getAttribute("src");
  const pageSizeControl = document.querySelector("#page-size");
  let settings = { ...TrackerSettings.defaults };
  let resetImage = false;
  let saving = false;

  function warn(message) {
    settingsWarning.textContent = message;
    settingsWarning.hidden = !message;
  }

  function apply(value, applyPageSize, applyPostReference) {
    const root = document.documentElement;
    root.dataset.accent = value.accent;
    root.dataset.textSize = value.textSize;
    root.dataset.density = value.density;
    root.dataset.partnerHighlights = value.partnerHighlights ? "on" : "off";
    document.querySelector("#partner-highlight-hint").hidden = !value.partnerHighlights;
    art.hidden = !value.showImage;
    art.src = value.image || defaultImage;
    if (applyPageSize) {
      pageSizeControl.value = value.pageSize;
      pageSizeControl.dispatchEvent(new Event("change"));
    }
    if (applyPostReference) {
      document.querySelector("#add-thread").dispatchEvent(
        new CustomEvent("post-reference-default", { detail: value.postReference })
      );
    }
  }

  function fillForm(value) {
    for (const field of ["accent", "textSize", "density", "pageSize", "postReference"]) {
      settingsForm.elements[field].value = value[field];
    }
    settingsForm.elements.showImage.checked = value.showImage;
    settingsForm.elements.partnerHighlights.checked = value.partnerHighlights;
    settingsForm.elements.image.value = "";
    resetImage = false;
    imageStatus.textContent = value.image ? "A custom image is currently saved." : "Using the default image.";
  }

  async function readImage(file) {
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
      throw new Error("Choose a PNG, JPEG, WebP or GIF image.");
    }
    if (!file.size || file.size > TrackerSettings.maxImageBytes) {
      throw new Error("Choose an image no larger than 2 MB.");
    }
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read the selected image."));
      reader.readAsDataURL(file);
    });
    const image = new Image();
    image.src = data;
    try {
      await image.decode();
    } catch {
      throw new Error("The selected file is not a readable image.");
    }
    return data;
  }

  try {
    settings = TrackerSettings.parse(localStorage.getItem(TrackerSettings.key));
  } catch {
    warn("Could not load browser settings. Defaults are in use; check browser storage or reset and save settings.");
  }
  apply(settings, true, true);

  document.querySelector("#open-settings").addEventListener("click", () => {
    fillForm(settings);
    settingsMessage.textContent = "";
    settingsDialog.showModal();
  });
  document.querySelector("#settings-close").addEventListener("click", () => settingsDialog.close());
  settingsDialog.addEventListener("cancel", (event) => {
    if (saving) event.preventDefault();
  });
  settingsForm.elements.image.addEventListener("change", () => {
    resetImage = false;
    imageStatus.textContent = settingsForm.elements.image.files.length
      ? "The selected image will be saved when you save settings."
      : (settings.image ? "A custom image is currently saved." : "Using the default image.");
  });
  document.querySelector("#settings-default-image").addEventListener("click", () => {
    settingsForm.elements.image.value = "";
    resetImage = true;
    imageStatus.textContent = "The default image will be used when you save settings.";
  });
  document.querySelector("#settings-reset").addEventListener("click", () => {
    fillForm(TrackerSettings.defaults);
    resetImage = true;
    imageStatus.textContent = "Defaults will be restored when you save settings.";
    settingsMessage.textContent = "";
  });
  settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    saving = true;
    const controls = Array.from(settingsForm.elements);
    controls.forEach((control) => { control.disabled = true; });
    settingsMessage.textContent = "";
    try {
      const file = settingsForm.elements.image.files[0];
      const value = {
        showImage: settingsForm.elements.showImage.checked,
        image: file ? await readImage(file) : resetImage ? null : settings.image,
        accent: settingsForm.elements.accent.value,
        textSize: settingsForm.elements.textSize.value,
        density: settingsForm.elements.density.value,
        partnerHighlights: settingsForm.elements.partnerHighlights.checked,
        pageSize: settingsForm.elements.pageSize.value,
        postReference: settingsForm.elements.postReference.value,
      };
      const serialized = JSON.stringify(value);
      TrackerSettings.parse(serialized);
      try {
        localStorage.setItem(TrackerSettings.key, serialized);
      } catch {
        throw new Error("Could not save settings. Browser storage may be blocked or full.");
      }
      const pageSizeChanged = value.pageSize !== settings.pageSize;
      const postReferenceChanged = value.postReference !== settings.postReference;
      settings = value;
      apply(settings, pageSizeChanged, postReferenceChanged);
      warn("");
      settingsDialog.close();
    } catch (error) {
      settingsMessage.textContent = error.message;
    } finally {
      saving = false;
      controls.forEach((control) => { control.disabled = false; });
    }
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== TrackerSettings.key && event.key !== null) return;
    try {
      const next = TrackerSettings.parse(event.key === null ? null : event.newValue);
      const pageSizeChanged = next.pageSize !== settings.pageSize;
      const postReferenceChanged = next.postReference !== settings.postReference;
      settings = next;
      apply(settings, pageSizeChanged, postReferenceChanged);
      warn("");
    } catch {
      warn("Could not load updated browser settings. Check browser storage or reset and save settings.");
    }
  });
}
