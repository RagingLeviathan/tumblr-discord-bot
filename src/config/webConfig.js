"use strict";

function getWebConfig(env = process.env) {
  const rawPort = env.PORT === undefined ? "3000" : env.PORT.trim();
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535.");
  }
  const port = Number(rawPort);
  const origin = `http://localhost:${port}`;
  return {
    host: "127.0.0.1",
    port,
    origin,
    redirectUri: `${origin}/callback`,
    allowedHosts: port === 80
      ? ["localhost", "127.0.0.1", "localhost:80", "127.0.0.1:80"]
      : [`localhost:${port}`, `127.0.0.1:${port}`],
  };
}

module.exports = { getWebConfig };
