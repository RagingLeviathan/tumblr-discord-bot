# Discord.js upgrade plan

Assessment date: 21 November 2026. Estimates are engineering time for one
developer, excluding waiting for credentials, approvals, or upstream support.
They are ranges, not commitments.

Update: The manifest now requires Discord.js 14.28.1 or later within v14,
and the bot listens for `Events.ClientReady`. The remaining upgrade and
verification work below is still a plan.

## Current state

- [`package.json`](../package.json) declares `discord.js: ^14.14.1`, not an
  older major version. The caret range permits newer v14 releases.
- The installed package reports **14.28.1**; the npm `latest` tag also
  reported **14.28.1** when checked. A v15 development tag exists, but is not
  the stable release. Check again before implementation.
- [`package-lock.json`](../.gitignore) is ignored, so a fresh install may resolve
  different versions within the allowed ranges. The version installed on one
  machine is not proof of what another deployment is running.
- npm reports Node.js `>=18` for 14.28.1; the inspected machine runs Node
  22.15.0. That version satisfies the package requirement but is not the latest
  Node 22 patch. Choose a currently supported LTS line and patch it; Node 18
  being accepted by the package does not mean it is still supported by Node.
- [`index.js`](../src/index.js) uses `Client`, gateway intents, `ready`,
  `messageCreate`, and `client.login`. The installed 14.28.1 source marks
  `ready` as deprecated in favor of `clientReady`, with the old event planned
  to disappear in v15. Existing prefix commands require the Message Content
  privileged intent and corresponding Developer Portal configuration.

## Recommendation and estimate

Stay on stable v14 and establish repeatable installs before considering v15.
This is a maintenance update, not a major-version migration.

| Work | Estimate | Outcome |
| --- | ---: | --- |
| Inventory deployment Node/npm and current installed versions | 0.5–1 hour | Confirm actual baseline and LTS choice |
| Set an agreed v14 minimum, choose and document Node version, commit a dependency lockfile after reviewing ignore rules | 1–2 hours | Repeatable clean install; no secrets or local data committed |
| Migrate `ready` to `clientReady`, check gateway intents and login/send errors | 1–2 hours | Remove the identified deprecation without changing command behavior |
| Run focused tests and clean-install smoke test in a test Discord server | 2–4 hours | Verify commands, reconnect and error reporting |
| **Total** | **4.5–9 hours** | Excludes unrelated security fixes and new commands |

If dependency resolution exposes conflicts or the deployment runs an
unsupported Node version, allow an additional **2–6 hours**. A v15 migration
should be separately estimated once a stable release and migration guide
exist; its breaking changes are not established by the current dev tag.

## Proposed implementation sequence

1. Record the deployment Node version, Discord app settings, enabled intents
   and behavior of `$owl`, `$authorizetumblr`, and `$tumblrcracker` before
   changing dependencies. Do not copy tokens or follower data into logs.
2. Select a supported Node LTS baseline and update the manifest's Discord.js
   minimum to the agreed stable v14 version. Decide whether to track the npm
   lockfile, audit the resulting dependency changes, and use clean installs
   thereafter. Other dependency upgrades belong in separate changes.
3. Use `Events.ClientReady` or the supported `clientReady` event; register
   message handlers so reconnects do not duplicate them. Preserve the existing
   command names and blog override/default behavior.
4. Check privileged intent configuration and requested bot permissions. Keep
   Message Content while prefix commands remain; remove it only after a
   separately approved migration away from those commands.
5. In a private test guild, verify login, startup, reconnection, `$owl`, auth
   link generation, follower-command invocation and failure reporting. Use
   mocks for Tumblr and synthetic follower data; a real Tumblr smoke test
   requires the user's credentials and an authorized account.
6. Document how to install and start, review dependency audit results, and
   deploy with a rollback path to the prior manifest and lockfile.

## Acceptance criteria

- A clean install resolves the intended v14 version and runs on the chosen
  supported Node version.
- The ready-event deprecation no longer appears; reconnects do not register
  duplicate message handlers.
- Existing commands behave as before, and missing permissions or failed logins
  are surfaced without exposing credentials.
- Automated checks pass and a test-guild smoke test is recorded.

## Sources

- [Discord.js releases](https://github.com/discordjs/discord.js/releases)
- [Discord gateway intents](https://docs.discord.com/developers/events/gateway#gateway-intents)
- [Node.js release status](https://nodejs.org/en/about/previous-releases)
- Local evidence: [`package.json`](../package.json),
  [`index.js`](../src/index.js), and the installed `discord.js` 14.28.1 source.
