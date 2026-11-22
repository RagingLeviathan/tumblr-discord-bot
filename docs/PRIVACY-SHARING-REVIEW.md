# Privacy review before sharing

Review performed on 21 November 2026 against the local working tree and locally
available branch history. The separate data repository was not inspected.
Recheck the live remote and its branches before making the repository public.

## Recommended changes

### 1. Review historical follower data

The last-fetched `origin/main` history contains older `missing_names.json`
versions with 14 and 20 blog-name-shaped entries. Review these as potentially
private follower data before sharing.

Deleting or ignoring a file now does not remove older commits. If the history
needs cleaning, plan that separately: rewriting shared history affects other
branches and clones, and existing copies may remain accessible.

### 2. Close ignore gaps

- Extend [`.gitignore`](../.gitignore) to cover credential variants such as
  `.env.local` and `.env.production`, while retaining the placeholder
  [`.env-example`](../.env-example).
- Ignore legacy root-level thread files such as `tracked_threads.json` and
  `tracked_threads_<blog>.json`, as well as root-level follower comparison
  reports.
- Stop tracking [`missing_names.json`](../data/legacy/missing_names.json) and
  [`new_followers.json`](../data/legacy/new_followers.json) under `data/legacy/`
  and ignore them instead. Both are currently empty, but future updates could
  add personal information. Preserve local copies when untracking them.
- Verify ignored paths and staged changes before committing. Ignore rules do not
  protect files already tracked, and they do not clean Git history.

### 3. Include required application source

The `followers*` ignore rule also matches
[`src/followers/`](../src/followers/). Its three JavaScript files are required
by the application but are missing from the last-fetched `origin/main` tree.
Narrow the rule to generated follower data and add the source files, reviewing
their contents before committing. A fresh clone otherwise cannot run the app.

### 4. Replace identifying examples

The default blog in [`blogConfig.js`](../src/config/blogConfig.js), the
tracker's placeholders, tests and README include a personal blog name and
real-looking post links. Replace these with fictional examples if they should
not be shared. Changing the runtime fallback is a behaviour change: update its
configuration guidance and tests together.

### 5. Restrict Discord output and redact logs

The legacy `$tumblrcracker` command in [`src/index.js`](../src/index.js) is not
restricted to the configured owner and can send a follower file to the channel
where it is invoked. Slash commands restrict invocation to the configured owner,
but their replies and follower-comparison attachments can still be visible to
that channel. Restrict access and choose an appropriate private delivery method
before using the bot in shared Discord servers.

The legacy follower code can log API responses and full error objects; those
may include private data or request credentials. Replace these with minimal,
redacted diagnostics and review existing logs before sharing them.

## What was already protected

- The current `.env`, most of `data/`, local shortcuts and `node_modules/` are
  ignored. The tracked `.env-example` uses placeholder-like values.
- A limited pattern scan of tracked text and locally available branch history
  found no obvious credential matches. This is not a comprehensive secret scan
  or a guarantee that no credentials or private data exist.
- The tracker is currently intended for local, single-user use. Git ignore
  rules and branch protection do not make a public repository private.

If a credential is found to have been exposed, revoke or rotate it and address
the affected history. No files or remote settings were changed by the review.
