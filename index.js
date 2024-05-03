'use strict';
require('dotenv').config();
const { main } = require('./tumblrcracker');
const token = process.env['DISCORD_CLIENT_SECRET'];
const { Client, GatewayIntentBits, InteractionResponseType } = require("discord.js");
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const app = express();
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const CLIENT_ID = process.env.CONSUMER_KEY;
const CLIENT_SECRET = process.env.CONSUMER_SECRET;
const REDIRECT_URI = 'http://localhost:3000/callback'; // This should match the redirect URI registered in your OAuth application

//grab from discord bot
let accessToken;
let blogName;

// Endpoint to initiate the authorization process
app.get('/authorize', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    // Construct the authorization URL
    const authorizationUrl = `https://www.tumblr.com/oauth2/authorize?client_id=${CLIENT_ID}&response_type=code&scope=basic&state=${state}&redirect_uri=${REDIRECT_URI}`;

    // Redirect the user to the authorization URL
    res.redirect(authorizationUrl);
});

// Callback endpoint to handle the authorization response
app.get('/callback', async (req, res) => {
    const code = req.query.code; // Authorization code received in the callback

    console.log('authorization code got is: ', code);
    // Exchange the authorization code for an access token
    accessToken = await exchangeCodeForToken(code);

    console.log('accesstoken obtained is:' , accessToken);

    // Handle the access token accordingly (e.g., store it securely, make API calls)
    
    res.send('Authorization successful! You can now use your bot.'); // Send a response to the user
});

// Function to exchange authorization code for an access token
async function exchangeCodeForToken(code) {
    const tokenUrl = 'https://api.tumblr.com/v2/oauth2/token';

    const params = new URLSearchParams();
    params.append('client_id', CLIENT_ID);
    params.append('client_secret', CLIENT_SECRET);
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', REDIRECT_URI);

    console.log(params.toString());

    const response = await axios({
        method: 'post',
        url: tokenUrl,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        data: params
    });

    //const data = await response.json();
    const data = await response;
    console.log('we got this data from the exchange; ', data);
    return data.data.access_token;
}


//begin discord bot reactions

client.on("ready", () => {
    console.log("The owl bot is online. 🦉"); //message when bot is online

    client.on("messageCreate", async (message) => {
       // console.log(message);
        if (message.content === "$owl") {
            console.log('test selected');
            message.channel.send("OK, I'm here! What do you need? 🦉");
        }

        if (message.content.startsWith("$tumblrcracker")) {
            console.log('tumblrcracker selected');

            message.channel.send("Tumblr cracker is running! 🦉");

            // Split the message content into parts
    const parts = message.content.split(' ');

    // The first part should be the command trigger
    const command = parts[0];

    // The second part should be the blog name
    const blogName = parts[1];

    // You can now use blogName in your code
    console.log(`Blog name: ${blogName}`);



            try {
                let result = await main(blogName, accessToken);
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

        //tumblr api authing
        if (message.content === "$authorizetumblr") {
            // Construct the authorization URL
            const authorizationUrl = `http://localhost:3000/authorize`;
    
            // Send the authorization URL as a message to the channel
            message.channel.send(`Authorize your Tumblr account: ${authorizationUrl}`);
        }
    });
    

});

// Start the express server
const server = app.listen(3000, () => {
    console.log('Authorization server is running on port 3000');
});

client.login(token);