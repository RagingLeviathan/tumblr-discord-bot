# Copilot instructions

## Project

- This is a Node.js/CommonJS Tumblr and Discord bot with a local, single-user
  thread tracker. `src/index.js` starts both the Express server and Discord
  client. The tracker frontend is plain HTML, CSS and JavaScript in
  `public/threads/`; avoid adding a framework for small changes.
- Keep the web server bound to loopback. It has no application login or
  multi-user access controls; do not expose it through a public port, proxy or
  tunnel without a separate security redesign and review.
- Tumblr authorization uses a browser-bound state cookie and a
  `localhost:<PORT>/callback` redirect. The access token stays in memory and
  requires reauthorization after restart or expiry. Do not log credentials.

## Data and privacy

- Treat `.env`, `data/`, follower lists, thread and ask records, audit logs and
  browser settings as potentially private. Never commit credentials or real
  user data. Check what Git actually tracks: ignore rules do not protect
  already tracked files, and `data/legacy/` has tracked exceptions.
- `src/config/dataPaths.js` defines the data locations. Preserve existing
  collections and migration markers; do not overwrite, delete or migrate real
  data for testing. Use temporary directories and synthetic fixtures instead.
- The optional backup mirrors data to a separate private GitHub repository.
  Never run a real backup, push data or alter that repository as part of a
  test. Preserve its privacy checks, non-force push and recovery behavior.
- Slash commands are owner-restricted, but successful responses and attachments
  are channel-visible. The legacy `$` commands do not have that restriction;
  do not imply otherwise.
- `npm run compare-followers` compares the two most recently modified legacy
  follower snapshots by default and writes a local diff; use synthetic files
  and an explicit temporary output when testing, never real follower records.

## Tracker behavior

- Tumblr post IDs must remain strings to avoid precision loss. Reuse
  `public/threads/postReference.js` for URL and post-ID validation on both the
  frontend and backend. A post ID must be paired with the blog that published
  that specific post.
- The latest reblog can come from any branch of the saved post, not necessarily
  the writing partner. Preserve the shared reblog cache, request pacing,
  rate-limit cooldown and stale-result warnings when changing lookups. The UI
  loads cached results for all rows, automatically checks only visible missing
  or expired results, and also checks newly saved or edited rows even when
  filters hide them. Explicit per-row checks and bulk blog-ID updates remain
  user initiated.
- Blog UUIDs identify blogs, not people. Preserve verified saved-post UUIDs
  and resolved names without overwriting original references; do not guess
  identities when verification fails. The bulk update uses the paced queue,
  reports failures and stops on rate limits or collection changes.
- Possible-duplicate highlighting is a clue based on exact reblog timestamps
  and matching UUIDs, or matching names only when both UUIDs are unknown.
  Manual merging is separate and restricted to a shared writing partner.
  Preserve merge metadata and reject conflicting nonempty notes rather than
  silently discarding them.
- The web tracker and Discord thread commands share per-blog collections.
  Preserve existing titles, completion and favourite flags, AU assignments,
  notes, duplicate detection and migration behavior when modifying storage.
  Thread notes are local, included in data backups, and limited to 1,000
  UTF-16 code units; they are not posted to Tumblr.
- Post-ID verification failures may offer an explicit unverified URL fallback;
  never imply the link was verified or already saved. Preserve the step-by-step
  confirmation and visible errors.
- Saved asks are manual links, not a live Tumblr inbox. Marking one answered or
  removing it only removes the local entry; do not imply it changes Tumblr.
- Keep table filters, sorting, pagination and random selection consistent:
  random selection uses all matching pages, preferring the latest reblog link
  and falling back to the saved post when unavailable. Clearing table filters
  and clearing the entry form are independent. Starred-first groups favourites
  within matching results without hiding other threads. Post dates use
  browser-local time with the year and seconds displayed.
- Settings and uploaded banner images are stored in browser localStorage, not
  in the data backup. Preserve compatibility with previously saved settings.

## Changes and verification

- Preserve unrelated work and existing UI behavior. Update `README.md` when
  changing user-visible functionality, setup or limitations.
- Use the existing `node:test` suite in `test/`. Run focused tests with
  `node --test test/<file>.test.js`; `npm test` runs the full suite. On Windows,
  use `npm.cmd` if PowerShell blocks `npm.ps1`.
- For UI changes, use an isolated preview with synthetic data; do not manipulate
  the user's running bot or real records. Cover filters, pagination, empty and
  loading states, and narrow-screen layout when relevant.
- Keep errors visible and preserve existing validation and privacy safeguards.
  Do not assume Tumblr supports an undocumented endpoint or behavior; verify
  it before relying on it.
