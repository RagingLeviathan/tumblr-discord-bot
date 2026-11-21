# Code, reliability and security improvement plan

Assessment date: 21 November 2026. This is a focused planning review of the
current local code, not a comprehensive security audit or an assertion that
all issues are remotely exploitable. It includes existing uncommitted changes.
No credentials or follower data were inspected for this report.

Update: The server now binds to loopback and the Tumblr OAuth callback validates
browser-bound, expiring state. Known credential-bearing logs in the OAuth and
follower invocation paths were removed. The local web interface still has no
per-user authentication or general CSRF protection; the remaining risks and
proposed work below should be reassessed before any network deployment.

## Immediate priorities

| Priority | Evidence and impact | Proposed work |
| --- | --- | --- |
| High | [`index.js`](../src/index.js) logs the OAuth authorization code, access token, token exchange parameters and response, and logs the token again when invoking the follower command. The OAuth client secret and bearer token can therefore reach console/log storage. [`fetchFollowersWithToken.js`](../src/followers/fetchFollowersWithToken.js) also logs an Axios instance containing authorization headers. | Remove/redact secrets and credential-bearing objects from all logs. Review existing logs and their retention; if exposed, rotate affected credentials and revoke tokens as appropriate. Do not print secrets during testing. |
| High | [`index.js`](../src/index.js) creates an OAuth `state` but does not store or validate it in `/callback`. A callback can therefore be accepted without proving it belongs to the initiated authorization flow. Its single in-memory `accessToken` is shared across all users and resets on restart. | Bind a cryptographically random, expiring, single-use state to the initiating session, reject mismatches and callback errors, and define the intended single-user or multi-user token ownership model before persisting tokens. Investigate the supported OAuth flow and secure token storage. |
| High | The Express server listens without an explicit loopback host, and [`threadRoutes.js`](../src/threads/threadRoutes.js) exposes unauthenticated thread reads and mutations. Discord message commands likewise have no user/channel authorization; `$tumblrcracker` uploads follower information to the invoking channel. Exposure depends on network and guild access. | Bind to loopback by default; add an explicit authorization model for the web API and Discord commands, origin/CSRF protections for browser mutations, and restrictive channel/user permissions for sensitive follower data. Loopback alone does not protect against a malicious website or other local users. |
| High | [`tumblrcracker.js`](../src/followers/tumblrcracker.js) calls the followers endpoint with `limit=2000` for its initial count, while Tumblr documents 1–20. It then uses a different OAuth 1 credential pair for the actual pages. [`fetchFollowersWithToken.js`](../src/followers/fetchFollowersWithToken.js) logs a refresh attempt but does not refresh OAuth 2 tokens. | Verify the actual supported OAuth 2 scopes and access for followers against Tumblr and choose one coherent authorization path. Use documented page limits; handle expired/unauthorized tokens explicitly. Verify using an authorized test blog rather than assuming either credential grants access. |
| High | [`index.js`](../src/index.js) did not import `getCurrentDate()` and computed the attachment name separately from the write. The follower service now returns the exact written path. Message sends are still not awaited, and exceptions are not reported to the caller. | Await sends and handle attachment failures, and report errors safely in Discord. Test success, write failure and send failure. |
| High | [`tumblrcracker.js`](../src/followers/tumblrcracker.js) dereferences `error.response.headers` even for network failures, retries 429s without a bound, and can loop forever when a page has zero users while `remainingUsers` is positive. The OAuth 2 helper has similar unsafe error dereferences and unbounded 429 retries. | Add timeouts, guarded error handling, bounded retries with backoff and actual rate-limit guidance, and fail explicitly on no-progress pagination. Account for a changing follower count without silently producing a complete-looking partial snapshot. |

## Next priorities

| Priority | Evidence and impact | Proposed work |
| --- | --- | --- |
| Medium | Prefix matching uses `startsWith("$tumblrcracker")`; it can also match unintended command names. The handler is registered inside `ready`, so repeated ready events can register duplicates. No bot-author check or command access checks exist. | Parse exact commands, ignore bot messages, register handlers once, and centralize error handling and permissions. Preserve documented blog argument precedence. |
| Medium | [`threadTracker.js`](../src/threads/threadTracker.js) writes through a temporary file and renames it, but separate processes can still read the same old list and overwrite each other's updates. The file is shared globally and missing/malformed data is an error. | Keep one shared store service for web and bot; serialize writes within a process, define backup/recovery and multi-process behavior, and use a database or file locking if multiple processes are needed. Do not silently replace malformed data. |
| Medium | Refreshing each thread makes a Tumblr request; the browser limits concurrency to four but repeated users/refreshes can still exhaust shared quotas. | Add shared server-side concurrency/rate limiting, short-lived caching, timeouts and explicit per-thread errors; validate upstream rate-limit behavior. |
| Medium | Legacy snapshot files use hour-level names in [`tumblrcracker.js`](../src/followers/tumblrcracker.js); repeated runs in an hour may overwrite results. [`missingNames.js`](../scripts/missingNames.js) compares names, so renames/deactivation can look like unfollows. | Use unique, atomic snapshots; store metadata and describe comparisons as possible changes rather than certain unfollows. Evaluate stable Tumblr identifiers before changing comparison semantics. |
| Medium | [`package.json`](../package.json) lists built-in-module substitutes and packages whose use should be checked; the lockfile is ignored. The working tree includes an untracked `.env-example`. | Inventory imports before removing dependencies, commit a reviewed lockfile, and ensure example environment files contain placeholders only before adding them to Git. Keep real `.env` and private follower data out of version control. |
| Medium | There is no centralized configuration validation or startup error handling. OAuth callback failures can result in unhandled async errors in Express 4. | Validate config without echoing secrets; separate app creation from startup, catch async route failures, handle failed login/listen and graceful shutdown. |
| Low | Legacy commented code and duplicate helpers obscure the actual flow; scripts are not clearly separated from reusable services. | Extract small Tumblr, storage and Discord modules; remove obsolete commented code only after tests capture behavior. Improve naming, docs, and error types. |

## Suggested phases and estimates

1. **Containment (0.5–1.5 days):** stop credential logging, review exposure and
   rotate if necessary; restrict server and Discord access; test failures.
2. **Auth and follower correctness (1.5–3 days):** state validation, explicit
   ownership, consistent Tumblr authorization, bounded pagination and reliable
   snapshot/attachment flow. Token persistence or multi-user support may add
   substantial design and implementation time.
3. **Maintainability and operations (1–2 days):** shared services, configuration
   validation, locking strategy, clean installs, logging and targeted tests.

These are rough ranges, depend on the intended trust model and live Tumblr API
behavior, and overlap with the separate feature plan. Do not total them with
that plan without removing duplicated work.

## Validation and decisions

- Add tests for authorization state expiry/replay, denied users, missing
  credentials, pagination no-progress, rate limits, network errors, exact
  attachment path, and redaction. Avoid real secrets and real follower data.
- Verify Discord access from an unauthorized user and web mutations from an
  untrusted origin. Test with temporary data and a private test guild.
- Decide whether this is one trusted user's local tool or a shared/multi-user
  service; that choice determines ownership, access control and storage.
- Audit historical logs and `.env-example` locally without including contents
  in issues, pull requests, or chat.

Reference: [Tumblr API documentation](https://github.com/tumblr/docs/blob/master/api.md).
