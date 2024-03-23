'use strict';
require('dotenv').config();
const { main } = require('./tumblrcracker');
const token = process.env['DISCORD_CLIENT_SECRET'];
const { Client, GatewayIntentBits } = require("discord.js");
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});


client.on("ready", () => {
    console.log("The owl bot is online. 🦉"); //message when bot is online

    client.on("messageCreate", async (message) => {
       // console.log(message);
        if (message.content === "$owl") {
            console.log('test selected');
            message.channel.send("OK, I'm here! What do you need? 🦉");
        }

        if (message.content === "$tumblrcracker") {
            console.log('tumblrcracker selected');

            message.channel.send("Tumblr cracker is running! 🦉");


            try {
                let result = await main();
                console.log(result);
                if (result && result.success) {
                    console.log("main() returned true");
                    message.channel.send("Tumblr Followers list updated! Hoo! 🦉");
                    message.channel.send(result.data);
                } else {
                    console.log("main() returned false");
                    message.channel.send("Hoo... fell over and crashed... 🦉💦");
                }
            } catch (error) {
                console.error('Error calling main:', error);
            }





            
            
        }
    });
    

});

client.login(token);