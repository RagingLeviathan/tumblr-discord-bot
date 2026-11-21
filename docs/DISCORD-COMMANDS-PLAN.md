# Tumblr-linked Discord commands: feasibility and feature plan

Assessment date: 21 November 2026. This is a proposal only; command names,
privacy defaults and scheduling require approval. Estimates assume one
developer, an existing private test guild, and working Tumblr credentials.

## Feasibility

**Yes:** the existing Discord bot can expose Tumblr-backed commands. The
current code already has prefix commands in [`index.js`](../src/index.js), and
the thread store and notes lookup are reusable from
[`threadTracker.js`](../src/threads/threadTracker.js). New Discord commands should call a
shared service rather than making HTTP calls to the app's own web endpoints.
Both surfaces must use the same validated store and authorization policy.

Tumblr documents API-key access for public post notes and published posts,
and OAuth for followers. A valid API key does not grant access to restricted
posts or someone else's followers. Live endpoint behavior, permissions and
quota must be tested with an authorized account; existing tests use mocks.
Notes are reverse chronological, and the current tracker chooses the latest
reblog of the saved post by **any blog**. It does not identify a particular
conversation branch, determine whose turn it is, or filter by roleplay partner.

## Proposed command set

| Command | Purpose and Tumblr dependency | Feasibility / caveat | Rough effort |
| --- | --- | --- | ---: |
| `/thread add` | Save a title and Tumblr post URL | Reuse URL parsing, deduplication and JSON store; authorize mutations | 2–4 h |
| `/thread list` | List tracked titles and links | Local store; paginate and respect Discord response limits | 2–4 h |
| `/thread latest` | Show latest reblogger, date and link for a tracked post | Reuse notes API; report no reblogs, rate limits and inaccessible posts distinctly | 2–4 h |
| `/thread remove` | Stop tracking a selected post | Reuse store; confirmation and authorization required | 1–3 h |
| `/blog recent` | Show recent public posts for a blog | Tumblr published posts endpoint with API key; validate blog and link output | 3–6 h |
| `/followers snapshot` and `/followers compare` | Capture or compare snapshots | OAuth and sensitive data; depends on follower correctness/security work and a deliberate retention/sharing policy | 1–2 days after prerequisites |
| Optional notifications | Notify a chosen channel when the latest reblog changes | Requires persistent per-thread baseline, polling schedule, quota budget, deduplication, restart/retry behavior, and opt-in permissions | 1–3 days after basic tracker |

Estimates are for implementation and focused tests, not external approval or
waiting on Tumblr. Initial shared command infrastructure is **0.5–1 day**;
the four thread commands together are roughly **1–2 additional days**, with
overlap in the individual ranges. Follower and notification features are
separate later phases, not included in that total. Security and reliability
prerequisites may add **1–3 days or more**; do not double-count work from the
other plans.

## Recommended approach

1. **Confirm scope and permissions.** Decide whether the JSON thread list is
   personal to the bot owner or shared by an entire guild, who may add/remove,
   which channels can show results, and whether responses are private by
   default. The current file is global, not per-guild or per-user.
2. **Harden prerequisites.** Address credential logging, OAuth state and command
   access before exposing follower data or mutations. Make storage writes safe
   for simultaneous requests. See [code and security plan](./CODE-AND-SECURITY-PLAN.md).
3. **Add slash-command infrastructure.** Register application commands in a
   test guild, handle `interactionCreate`, validate input, and acknowledge
   slow commands promptly with a deferred response. Discord requires an
   initial response within three seconds; interaction tokens have a limited
   lifetime. Longer snapshot jobs need a separate completion delivery strategy.
   Apply authorization server-side even if command permissions are configured.
4. **Build the four thread commands.** Share `createThreadStore`,
   `parsePostUrl` and `getLastReblog`, or extract a shared service. Preserve
   post IDs as strings. Use safe Discord output (no unintended mentions),
   paginate lists, and show clear per-thread errors and the any-branch caveat.
5. **Validate in a private guild.** Test registration, authorized/denied users,
   adding duplicate or malformed URLs, persistence shared with the web view,
   removing entries, empty lists, pagination, missing keys, 404/429/timeouts,
   and no-reblog vs error states. Confirm response timing with slow mocks and
   do one permitted live public-post smoke test.
6. **Roll out gradually.** Keep `$owl`, `$authorizetumblr`, and
   `$tumblrcracker` initially; no implicit removal or breaking behavior.
   Once migration is explicitly agreed, determine whether Message Content
   intent can be removed. Provide documented registration and rollback steps.

## Open decisions

- One shared list or separate lists per user/guild? The latter needs an ownership
  schema and migration of existing `tracked_threads.json`, not just commands.
- Who may view or modify threads and follower data, and should outputs be
  ephemeral or sent to selected channels?
- Is a latest reblog from anyone sufficient long term, or should partner/branch
  tracking be investigated separately? Tumblr's notes do not automatically
  provide a reliable roleplay-turn model.
- Are scheduled notifications wanted? If so, choose polling interval, maximum
  tracked threads and delivery behavior after downtime, taking shared Tumblr
  quotas into account.
- Should follower comparison be limited to aggregates, or is a named list
  acceptable? Define retention, privacy and where files may be delivered.

## Sources

- [Discord application commands](https://docs.discord.com/developers/interactions/application-commands)
- [Discord interaction responses and timing](https://docs.discord.com/developers/interactions/receiving-and-responding)
- [Tumblr API: notes, posts, followers and authentication](https://github.com/tumblr/docs/blob/master/api.md)
