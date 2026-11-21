"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const settings = require("../public/threads/settings");

test("loads defaults or valid saved browser settings", () => {
  assert.deepEqual(settings.parse(null), settings.defaults);
  const saved = { ...settings.defaults, showImage: false, image: "data:image/png;base64,YQ==",
    accent: "teal", textSize: "large", density: "compact", partnerHighlights: false, pageSize: "50" };
  assert.deepEqual(settings.parse(JSON.stringify(saved)), saved);
});

test("migrates older settings and retains the chosen post reference", () => {
  const { postReference, ...olderSettings } = settings.defaults;
  assert.equal(settings.parse(JSON.stringify(olderSettings)).postReference, "id");
  assert.equal(settings.parse(JSON.stringify({ ...olderSettings, postReference: "url" })).postReference, "url");
  assert.throws(() => settings.parse(JSON.stringify({ ...olderSettings, postReference: null })));
});

test("rejects corrupt settings and unsupported or oversized images", () => {
  assert.throws(() => settings.parse("{"));
  for (const change of [
    { pageSize: "0" },
    { accent: "unknown" },
    { partnerHighlights: "false" },
    { image: "data:image/svg+xml;base64,YQ==" },
    { image: "https://example.com/image.png" },
    { image: `data:image/png;base64,${"A".repeat(settings.maxImageBytes * 2)}` },
  ]) {
    assert.throws(() => settings.parse(JSON.stringify({ ...settings.defaults, ...change })));
  }
});
