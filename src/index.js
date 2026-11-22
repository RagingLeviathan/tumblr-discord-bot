"use strict";
const { getDefaultBlog } = require("./config/blogConfig");
require("dotenv").config();
const { migrateData } = require("./config/migrateData");
migrateData();
const { main } = require("./followers/tumblrcracker");
const token = process.env["DISCORD_CLIENT_SECRET"];
const {
  Client,
  Events,
  GatewayIntentBits,
  InteractionResponseType,
} = require("discord.js");
const express = require("express");
const axios = require("axios");
const path = require("path");
const { createThreadRoutes } = require("./threads/threadRoutes");
const { createReblogCache } = require("./threads/reblogCache");
const { SlashCommands } = require("./discord/slashCommands");
const { createTumblrAuth } = require("./config/tumblrAuth");
const { getWebConfig } = require("./config/webConfig");
const webConfig = getWebConfig();
const CLIENT_ID = process.env.CONSUMER_KEY;
const CLIENT_SECRET = process.env.CONSUMER_SECRET;
const tumblrAuth = createTumblrAuth({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: webConfig.redirectUri, api: axios });
const reblogCache = createReblogCache();
const app = express();
app.use((req, res, next) => {
  if (!webConfig.allowedHosts.includes(req.get("host"))) {
    return res.status(400).send(`Use ${webConfig.origin} to access the tracker.`);
  }
  next();
});
app.get("/authorize", (req, res, next) => {
  if (req.get("host") === `127.0.0.1:${webConfig.port}` ||
      (webConfig.port === 80 && req.get("host") === "127.0.0.1")) {
    return res.redirect(`${webConfig.origin}/authorize`);
  }
  next();
});
app.use(tumblrAuth.router);
app.use("/api/threads", createThreadRoutes({ getAccessToken: tumblrAuth.getToken, getReblog: reblogCache.get, getCachedReblogs: reblogCache.snapshot, verifyCachedPost: reblogCache.verify }));
app.use("/threads", express.static(path.join(__dirname, "..", "public", "threads")));
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});
const slashCommands = new SlashCommands({ getReblog: reblogCache.get });
client.on("interactionCreate", (interaction) => {
  slashCommands.handle(interaction).catch((error) => {
    console.error("Could not respond to slash command:", error.code || error.name);
  });
});

//begin discord bot reactions

client.on(Events.ClientReady, () => {
  console.log("The owl bot is online. 🦉"); //message when bot is online
  console.log(
    `Authorize your Tumblr account here: ${webConfig.origin}/authorize`
  );

  client.on("messageCreate", async (message) => {
    // console.log(message);
    if (message.content === "$owl") {
      console.log("test selected");
      message.channel.send("OK, I'm here! What do you need? 🦉");
    }

    if (message.content.startsWith("$tumblrcracker")) {
      console.log("tumblrcracker selected");

      message.channel.send("Tumblr cracker is running! 🦉");

      const parts = message.content.trim().split(/\s+/);
      const blogName = parts[1] || getDefaultBlog();
      console.log(`Blog name: ${blogName}`);

      try {
        let result = await main(blogName, tumblrAuth.getToken());
        if (result && result.success) {
          console.log("main() returned true");
          message.channel.send("Tumblr Followers list updated! Hoo! 🦉");
          // Send a summary instead
          const followerCount = JSON.parse(result.data).length;
          message.channel.send(`Fetched ${followerCount} followers. Data saved to file.`);

          // Or, upload the file if you want to share the full data:
          message.channel.send({ files: [result.filePath] });
        } else {
          console.log("main() returned false");
          message.channel.send("Hoo... fell over and crashed... 🦉💦");
        }
      } catch (error) {
        console.error("Error calling main:", error.code || error.name);
      }
    }

    //tumblr api authing
    if (message.content === "$authorizetumblr") {
      // Construct the authorization URL
      const authorizationUrl = `${webConfig.origin}/authorize`;

      // Send the authorization URL as a message to the channel
      message.channel.send(
        `Authorize your Tumblr account: ${authorizationUrl}`
      );
    }
  });
});

// Start the express server
const server = app.listen(webConfig.port, webConfig.host, () => {
  console.log(`Authorization server is running on ${webConfig.host}:${webConfig.port}`);
  console.log(`Thread tracker: ${webConfig.origin}/threads/`);
});

client.login(token);
