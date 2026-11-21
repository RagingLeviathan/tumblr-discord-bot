"use strict";

require("dotenv").config();
const { REST, Routes } = require("discord.js");
const { commands } = require("../src/discord/slashCommands");

async function register() {
  const token = process.env.DISCORD_CLIENT_SECRET;
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!token || !clientId || !/^\d+$/.test(clientId)) {
    throw new Error("Set DISCORD_CLIENT_SECRET (bot token) and DISCORD_CLIENT_ID (application ID) in .env.");
  }
  const rest = new REST({ version: "10" }).setToken(token);
  // Upsert each named command without deleting unrelated global commands.
  for (const command of commands) {
    await rest.post(Routes.applicationCommands(clientId), { body: command });
    console.log(`Registered /${command.name}.`);
  }
  console.log("Global commands can take time to appear in Discord.");
}

register().catch((error) => {
  console.error("Could not register slash commands:", error.code || (error.status ? `HTTP ${error.status}` : error.message));
  process.exitCode = 1;
});
