"use strict";

const crypto = require("crypto");
const express = require("express");

function createTumblrAuth({ clientId, clientSecret, redirectUri, api, now = () => Date.now() }) {
  const router = express.Router();
  const pending = new Map();
  let token = null;
  const cookieName = "tumblr_oauth_state";

  router.get("/authorize", (req, res) => {
    if (!clientId || !clientSecret) return res.status(503).send("Configure CONSUMER_KEY and CONSUMER_SECRET first.");
    for (const [key, expires] of pending) if (expires <= now()) pending.delete(key);
    const state = crypto.randomBytes(32).toString("hex");
    pending.set(state, now() + 10 * 60 * 1000);
    res.cookie(cookieName, state, { httpOnly: true, sameSite: "lax", maxAge: 10 * 60 * 1000, path: "/callback" });
    const url = new URL("https://www.tumblr.com/oauth2/authorize");
    for (const [key, value] of Object.entries({ client_id: clientId, response_type: "code", scope: "basic", state, redirect_uri: redirectUri })) {
      url.searchParams.set(key, value);
    }
    res.redirect(url.toString());
  });

  router.get("/callback", async (req, res) => {
    const state = req.query.state;
    const cookie = (req.headers.cookie || "").split(";").map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`));
    const cookieState = cookie ? cookie.slice(cookieName.length + 1) : "";
    res.clearCookie(cookieName, { path: "/callback", sameSite: "lax", httpOnly: true });
    const expires = typeof state === "string" ? pending.get(state) : undefined;
    if (typeof state === "string") pending.delete(state);
    if (!expires || expires <= now() || state !== cookieState) {
      return res.status(400).send("Invalid or expired authorization request. Start again from this browser.");
    }
    if (req.query.error) return res.status(400).send("Tumblr authorization was declined or failed.");
    if (typeof req.query.code !== "string" || !req.query.code) return res.status(400).send("Tumblr did not return an authorization code.");
    try {
      const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret,
        grant_type: "authorization_code", code: req.query.code, redirect_uri: redirectUri });
      const response = await api.post("https://api.tumblr.com/v2/oauth2/token", body,
        { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 10000 });
      if (!response.data || typeof response.data.access_token !== "string" || !response.data.access_token) {
        throw new Error("Missing access token");
      }
      token = response.data.access_token;
      res.send("Tumblr authorization successful. Return to the thread tracker.");
    } catch (error) {
      console.error("Tumblr authorization failed:", error.code || error.name);
      res.status(502).send("Could not complete Tumblr authorization. Check the server log and try again.");
    }
  });

  return { router, getToken: () => token };
}

module.exports = { createTumblrAuth };
