"use strict";

const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const axios = require("axios");
const { createBlogThreadStore, getLastReblog, parsePostUrl, ValidationError } = require("../threads/threadTracker");
const { createFollowerSnapshots, normalizeBlog, SnapshotError } = require("../followers/snapshotService");
const { getDefaultBlog } = require("../config/blogConfig");
const { createSlashAudit } = require("./slashAudit");

const urlOption = (option) => option.setName("url").setDescription("Tumblr post URL").setRequired(true);
const blogOption = (option) => option.setName("blog").setDescription("Tumblr blog name (defaults to BLOG_NAME)");
const commands = [
  new SlashCommandBuilder().setName("thread").setDescription("Manage tracked Tumblr threads")
    .addSubcommand((sub) => sub.setName("add").setDescription("Track a Tumblr post")
      .addStringOption((option) => option.setName("title").setDescription("Thread title").setRequired(true).setMaxLength(200))
      .addStringOption(urlOption))
    .addSubcommand((sub) => sub.setName("list").setDescription("List tracked threads")
      .addIntegerOption((option) => option.setName("page").setDescription("Page number").setMinValue(1)))
    .addSubcommand((sub) => sub.setName("latest").setDescription("Show the latest reblog of a tracked post").addStringOption(urlOption))
    .addSubcommand((sub) => sub.setName("remove").setDescription("Remove a tracked post")
      .addStringOption(urlOption)
      .addBooleanOption((option) => option.setName("confirm").setDescription("Set true to confirm removal").setRequired(true))),
  new SlashCommandBuilder().setName("blog").setDescription("Look up a Tumblr blog")
    .addSubcommand((sub) => sub.setName("recent").setDescription("Show recent public posts").addStringOption(blogOption)),
  new SlashCommandBuilder().setName("followers").setDescription("Snapshot and compare followers")
    .addSubcommand((sub) => sub.setName("snapshot").setDescription("Save a follower snapshot").addStringOption(blogOption))
    .addSubcommand((sub) => sub.setName("compare").setDescription("Compare the latest two snapshots").addStringOption(blogOption)),
].map((command) => command.toJSON());

function safeText(value) {
  return String(value).replace(/[\r\n]/g, " ").replace(/[`*_~|\\[\]<>]/g, "\\$&");
}

function describeError(error) {
  if (error instanceof ValidationError || error instanceof SnapshotError) return error.message;
  if (error.response) {
    if (error.response.status === 404) return "Tumblr could not find or access that post or blog.";
    if (error.response.status === 401 || error.response.status === 403) return "Tumblr rejected access. Check the credentials and permissions for this blog.";
    if (error.response.status === 429) return "Tumblr rate limit reached. Please try again later.";
    return `Tumblr returned HTTP ${error.response.status}. Please try again later.`;
  }
  if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") return "The Tumblr request timed out. Please try again.";
  if (error.code) return "The request or local storage failed. Check the bot's server log.";
  return "The command failed. Check the bot's server log.";
}

function auditPostUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return "[invalid URL]";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[invalid URL]";
  }
}

class SlashCommands {
  constructor({ store = createBlogThreadStore(), api = axios, snapshots = createFollowerSnapshots(), audit = createSlashAudit(), getOwner = () => process.env.DISCORD_OWNER_ID, getApiKey = () => process.env.CONSUMER_KEY, getBlog = getDefaultBlog } = {}) {
    Object.assign(this, { store, api, snapshots, audit, getOwner, getApiKey, getBlog });
  }

  async handle(interaction) {
    if (!interaction.isChatInputCommand() || !["thread", "blog", "followers"].includes(interaction.commandName)) return;
    const identity = {
      interactionId: interaction.id || null,
      command: interaction.commandName,
      userId: interaction.user.id,
      guildId: interaction.guildId || null,
      channelId: interaction.channelId || null,
    };
    const owner = this.getOwner();
    // Fail closed: slash-command registration does not restrict who can invoke a global command.
    if (!owner || !/^\d+$/.test(owner) || interaction.user.id !== owner) {
      try {
        this.audit.write({ ...identity, phase: "denied" });
      } catch (error) {
        console.error("Could not write slash audit:", error.code || error.name);
      }
      await interaction.reply({ content: "These commands are restricted to the configured bot owner.", flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return;
    }
    await interaction.deferReply();
    const subcommand = interaction.options.getSubcommand();
    const optionNames = {
      "thread:add": ["title", "url"], "thread:list": ["page"],
      "thread:latest": ["url"], "thread:remove": ["url", "confirm"],
      "blog:recent": ["blog"], "followers:snapshot": ["blog"], "followers:compare": ["blog"],
    };
    const options = {};
    for (const name of optionNames[`${interaction.commandName}:${subcommand}`] || []) {
      const value = name === "page" ? interaction.options.getInteger(name)
        : name === "confirm" ? interaction.options.getBoolean(name) : interaction.options.getString(name);
      if (value !== null) options[name] = name === "url" ? auditPostUrl(value) : value;
    }
    const context = { ...identity, subcommand, options };
    try {
      this.audit.write({ ...context, phase: "started" });
    } catch (error) {
      console.error("Could not write slash audit:", error.code || error.name);
      await interaction.editReply({ content: "Could not write the audit log; command was not run. Check the server log.", allowedMentions: { parse: [] } });
      return;
    }
    let result;
    let outcome = "success";
    try {
      result = await this.execute(interaction);
    } catch (error) {
      console.error("Slash command failed:", error.code || (error.response && error.response.status) || error.name);
      outcome = "error";
      result = { content: describeError(error) };
    }
    try {
      this.audit.write({
        ...context, phase: "completed", outcome, response: result.content,
        attachments: (result.files || []).map((file) => file.name),
      });
    } catch (error) {
      console.error("Could not write slash audit:", error.code || error.name);
      result = { ...result, content: `${result.content.slice(0, 1850)}\nWarning: the command ran, but its result could not be written to the audit log.` };
    }
    try {
      await interaction.editReply({ ...result, allowedMentions: { parse: [] } });
    } catch (error) {
      try {
        this.audit.write({ ...context, phase: "delivery_failed" });
      } catch (auditError) {
        console.error("Could not write slash audit:", auditError.code || auditError.name);
      }
      throw error;
    }
  }

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const getString = (name) => interaction.options.getString(name);
    // Reblog notifications are handled separately by the user's Tumblr webhook.
    if (interaction.commandName === "thread") {
      if (sub === "add") {
        const thread = this.store.add(getString("title"), getString("url"));
        return { content: `Tracking **${safeText(thread.title)}**: ${thread.url}` };
      }
      if (sub === "list") {
        const threads = this.store.list();
        if (!threads.length) return { content: "No tracked threads yet." };
        const page = interaction.options.getInteger("page") || 1;
        const pages = [[]];
        let length = 0;
        for (const thread of threads) {
          const url = thread.url.length <= 1200 ? thread.url : "(Post URL too long to display.)";
          const item = `**${safeText(thread.title.slice(0, 200))}**\n${url}`;
          if (length + item.length + 2 > 1800) { pages.push([]); length = 0; }
          pages[pages.length - 1].push(item);
          length += item.length + 2;
        }
        if (page > pages.length) throw new ValidationError(`Page ${page} does not exist. There are ${pages.length} pages.`);
        return { content: `Tracked threads (page ${page}/${pages.length}):\n${pages[page - 1].join("\n\n")}` };
      }
      const reference = parsePostUrl(getString("url"));
      if (sub === "remove") {
        if (!interaction.options.getBoolean("confirm")) return { content: "Removal cancelled. Set confirm to true to remove the thread." };
        if (!this.store.remove(reference.blog, reference.postId)) throw new ValidationError("Tracked thread not found.");
        return { content: "Thread removed." };
      }
      if (sub === "latest") {
        const thread = this.store.list().find((item) => item.blog === reference.blog && item.postId === reference.postId);
        if (!thread) throw new ValidationError("Tracked thread not found.");
        const key = this.getApiKey();
        if (!key) throw new ValidationError("Set CONSUMER_KEY in .env to fetch Tumblr notes.");
        const { lastReblog, savedPost } = await getLastReblog(thread, key, this.api);
        if (!lastReblog) {
          const date = new Date(savedPost.timestamp * 1000).toISOString();
          return { content: `**${safeText(thread.title.slice(0, 200))}**\nNo reblogs found. Saved post by: ${safeText(savedPost.blog)}\nDate: ${date}${savedPost.url.length < 1200 ? `\n${savedPost.url}` : ""}` };
        }
        const date = new Date(lastReblog.timestamp * 1000);
        const when = Number.isNaN(date.getTime()) ? "Unknown date" : date.toISOString();
        return { content: `**${safeText(thread.title.slice(0, 200))}**\nLast reblogger: ${safeText(lastReblog.blog)}\nDate: ${when}${lastReblog.url && lastReblog.url.length < 1200 ? `\n${lastReblog.url}` : ""}\nThis may be from any branch.` };
      }
    }
    const blog = normalizeBlog(getString("blog") || this.getBlog());
    if (interaction.commandName === "blog" && sub === "recent") {
      const key = this.getApiKey();
      if (!key) throw new ValidationError("Set CONSUMER_KEY in .env to look up posts.");
      const response = await this.api.get(`https://api.tumblr.com/v2/blog/${encodeURIComponent(blog)}.tumblr.com/posts`, {
        params: { api_key: key, limit: 5 }, timeout: 10000,
      });
      const posts = response.data && response.data.response && response.data.response.posts;
      if (!Array.isArray(posts)) throw new Error("Tumblr returned an unexpected posts response.");
      if (!posts.length) return { content: `No public posts found for ${safeText(blog)}.` };
      const links = posts.map((post) => {
        if (typeof post.id_string !== "string" || !/^\d+$/.test(post.id_string)) throw new Error("Tumblr returned an invalid post ID.");
        return `https://www.tumblr.com/${blog}/${post.id_string}`;
      });
      return { content: `Recent posts from **${safeText(blog)}**:\n${links.join("\n")}` };
    }
    if (interaction.commandName === "followers" && sub === "snapshot") {
      const snapshot = await this.snapshots.snapshot(blog);
      const warning = snapshot.quality && snapshot.quality.incomplete
        ? `\nWarning: Tumblr returned ${snapshot.quality.duplicateCount} duplicate entries; this snapshot may be incomplete (${snapshot.count} unique names out of ${snapshot.quality.reportedTotal} reported).${snapshot.quality.retrySkipped ? " A retry was skipped due to the time limit." : " The retry also contained duplicates."}`
        : "";
      return { content: `Saved a snapshot of ${snapshot.count} followers for ${safeText(snapshot.blog)} at ${snapshot.createdAt}.${warning}` };
    }
    if (interaction.commandName === "followers" && sub === "compare") {
      const report = this.snapshots.compare(blog);
      const incomplete = (report.previousQuality && report.previousQuality.incomplete) ||
        (report.latestQuality && report.latestQuality.incomplete);
      return {
        content: `Compared snapshots for ${safeText(blog)} (${report.previous} to ${report.latest}).\nNew: ${report.newFollowers.length}; missing: ${report.missingFollowers.length}. Missing names can also reflect renames or deactivations.${incomplete ? " Warning: at least one snapshot may be incomplete due to duplicate entries, so these changes may be inaccurate." : ""} Details are in the attachment, visible to this channel.`,
        files: [{ attachment: Buffer.from(JSON.stringify(report, null, 2), "utf8"), name: "follower-comparison.json" }],
      };
    }
    throw new ValidationError("Unknown command.");
  }
}

module.exports = { SlashCommands, commands, describeError };
