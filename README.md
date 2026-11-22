```text
 _____ _   _ __  __ ____  _     ____
|_   _| | | |  \/  | __ )| |   |  _ \
  | | | | | | |\/| |  _ \| |   | |_) |
  | | | |_| | |  | | |_) | |___|  _ <
  |_|  \___/|_|  |_|____/|_____|_| \_\
 ____  ___ ____   ____ ___  ____  ____
|  _ \|_ _/ ___| / ___/ _ \|  _ \|  _ \
| | | || |\___ \| |  | | | | |_) | | | |
| |_| || | ___) | |__| |_| |  _ <| |_| |
|____/|___|____/ \____\___/|_| \_\____/
 ____   ___ _____
| __ ) / _ \_   _|
|  _ \| | | || |
| |_) | |_| || |
|____/ \___/ |_|
```

```text
                          /\_       _/\
                         /   `-._.-'   \
                        /  _         _  \
                   /\  /  /_`-.___.-'_\  \  /\
                  /  \/      \     /      \/  \
           /|    /_/|    .--._\   /_.--.    |\_\    |\
         _/ |___/  /    /     `-.-'     \    \  \___| \_
        /   / _/  /    |  \V\       /V/  |    \  \_ \   \
    /\_/   /_/   /     |   \ \     / /   |     \   \_\   \_/\
   /    __/    _/      |    \ `. .' /    |      \_    \__    \
  /_.-''   _.-'  \      \   .\  Y  /.   /      /  `-._   ``-._\
        .-'  _.-~ \      `-/\_\___/_/\-'      / ~-._  `-.
   _.-~~  .-'  _.-~~\       \       /       /~~-._  `-.  ~~-._
 ~'   _.-~  .-~     ~`-._    \  |  /    _.-'~     ~-.  ~-._   `~
  _.-~  .--'    _.-~     ~---.`-^-' .---~     ~-._    `--.  ~-._
 ~   .-~   _.-~~   .-~\__     ~-._.-~     __/~-.   ~~-._   ~-.   ~
   ~~   ~~~      ~~      ~~-._       _.-~~      ~~      ~~~   ~~
              ~~~             ~~~~~~~             ~~~
```

# tumblr-discord-bot

Leveraging the Tumblr API through a Discord bot.

## Tumblr and Discord capabilities

### Tumblr and the local tracker

- Track posts by URL or post ID, and see the latest reblogger and reblog date.
  The latest reblog can be from any branch, not necessarily your writing partner.
- Organize threads by writing partner and AU; mark them completed or favourite,
  filter and sort them, or open a random matching thread.
- Look up a post's available reblog trail using public or authenticated Tumblr
  access, and search Google for a post ID.
- Save ask links and notes manually for later. This does not read or change
  your Tumblr inbox.
- Fetch follower snapshots and compare them over time. Tumblr credentials and
  appropriate blog access are required.

See [Tracked threads](#tracked-threads) for setup, caching and API limitations.

### Discord

- `/thread add`, `/thread list`, `/thread latest` and `/thread remove` manage
  and check the same thread collection used by the local tracker.
- `/blog recent` lists up to five recent public posts.
- `/followers snapshot` saves a follower snapshot; `/followers compare`
  compares the latest two and returns a JSON attachment.
- The legacy `$tumblrcracker` command fetches a follower list, `$authorizetumblr`
  supplies the local authorization link, and `$owl` checks that the bot responds.

The slash commands are restricted to the configured owner, but their results
are visible in the Discord channel. The older `$` commands are not covered by
that restriction. See [Discord slash commands](#discord-slash-commands) and
[Follower command](#follower-command) for setup and privacy details. The web
tracker is local-only and is not a multi-user service.

## Prerequisites

- **Node.js and npm:** Install [Node.js](https://nodejs.org/) 18.17 or newer;
  a currently supported LTS release is recommended. npm is included with
  Node.js. Check them with `node --version` and `npm --version`, then run
  `npm install` in the project directory. If PowerShell blocks `npm.ps1` on
  Windows, use `npm.cmd` instead (for example, `npm.cmd install`).
- **Browser and network:** Use a modern browser with JavaScript enabled on the
  machine running the bot. Tumblr authorization needs cookies, and saving
  appearance settings needs browser storage. The bot needs internet access to
  Discord and Tumblr, and its local port (3000 by default) must be available.
- **Storage:** The project directory must be writable so the app can create
  and update its local `data/` files. Keep those files private and backed up.
- **Optional backups:** Install [Git](https://git-scm.com/) and use a separate
  private GitHub repository with appropriate credentials. See
  [Private GitHub data backups on Windows](#private-github-data-backups-on-windows).
- **Tumblr application:** Register an app at
  [Tumblr's application page](https://www.tumblr.com/oauth/apps). Put its
  OAuth consumer key (client ID) in `CONSUMER_KEY` and its consumer secret
  (client secret) in `CONSUMER_SECRET` in `.env`. For Tumblr authorization,
  register `http://localhost:3000/callback` as the callback URL, adjusting the
  port if you set `PORT`. Follower snapshots also require OAuth 1.0a user
  credentials `OAUTH_KEY` and `OAUTH_SECRET` authorized for the blog.
- **Discord bot and server:** Create an application and bot in the
  [Discord Developer Portal](https://discord.com/developers/applications),
  then install it in a server where you have permission to add apps. Include
  the `bot` and `applications.commands` scopes and grant the bot appropriate
  channel permissions, including permission to send messages and attachments.
  Put the application ID in `DISCORD_CLIENT_ID`, the **bot token** in
  `DISCORD_CLIENT_SECRET` (despite its name), and your Discord user ID in
  `DISCORD_OWNER_ID`. Enable the Message Content intent for the legacy `$`
  commands. See [Discord slash commands](#discord-slash-commands) to register
  the slash commands.

Copy `.env-example` to `.env` as a starting point and add any missing variables.
Keep `.env`, bot tokens and Tumblr secrets private; do not commit or share them.

## Local-only, single-user access

The web server listens on `127.0.0.1:3000` by default, on this computer only. Open
[http://localhost:3000/threads/](http://localhost:3000/threads/) on the same
computer; other devices cannot connect directly. Discord connectivity is
unaffected. Use `http://localhost:3000/callback` as the callback URL in your
Tumblr application and open the tracker at `localhost` when authorizing.
To use a different port, set `PORT=4321` in `.env` and restart the bot. Open
`http://localhost:4321/threads/` and change the registered Tumblr callback to
`http://localhost:4321/callback` to match. `PORT` must be between 1 and 65535;
invalid values prevent startup. The bind address remains loopback-only and
cannot be changed through configuration.

This is a local, single-user application, not a multi-user login system.
Other programs or people using this computer may still be able to access the
server and local data; do not expose it through a proxy or tunnel. A future
multi-user deployment would require separate credentials and sessions, access
controls, HTTPS and a security review.

## Hosting options

The Discord bot and web tracker run in the same Node.js process. The bot is
available only while that process and its host are running and connected to
Discord; a sleeping or shut-down laptop cannot keep it online.

| Option | How to run it | Tracker access |
| --- | --- | --- |
| Your Windows computer | Run `npm start` in the project directory, or use Task Scheduler to start it at sign-in. | Open `http://localhost:3000/threads/` on that computer. |
| A dedicated home computer or Raspberry Pi | Install Node.js and the project, configure `.env`, then run `npm start`. Use an OS service such as systemd to start and restart it. Keep the machine awake. | Use a browser on that machine, including through a secured private remote desktop. |
| A cloud virtual machine | Set up the project on a persistent VM and use its service manager to keep the process running. Expect hosting and storage costs. | A desktop/browser on the VM is needed for the tracker. Use a secured private remote desktop; do not expose the tracker itself to the internet. |

For Windows Task Scheduler, create a task triggered **At log on**, choose
**Run only when user is logged on**, and use the full path to `node.exe` as the
program, `index.js` as the argument, and the project's full path as **Start in**.
Check the task history and application output if it fails, and configure Windows
power settings if you need it to stay awake. Run only one bot instance against
the same data directory.

On any host, install dependencies with `npm install`, configure the Tumblr and
Discord credentials in `.env`, and keep that file private. The `data/` directory
must be writable and persistent across restarts and deployments; back it up
separately. The private GitHub backup instructions below are Windows-specific.
Browser settings and uploaded banner images are stored in that browser, not in
`data/`. The Tumblr authorization token is held only in process memory, so
authorize again after a restart or expiry using a browser on the host. Register
the matching `http://localhost:<port>/callback` with Tumblr.

Static hosting, serverless functions, and hosts that sleep, replace their local
filesystem, or require a publicly reachable web port are not suitable as-is.
The tracker binds to loopback and has no web login; do not publish it via a
reverse proxy, tunnel, or public port. Remote desktop access also needs its own
security and should not be exposed directly to the public internet.

## Project layout and data

- `index.js` starts the bot; `src/` contains the bot, web routes, configuration,
  and services.
- `scripts/` contains command registration and standalone utilities.
- `public/threads/` contains the thread tracker page; `test/` contains tests;
  `docs/` contains planning documents.
- `data/threads/` stores tracked thread collections and their migration backup.
- `data/follower-snapshots/` stores slash-command follower snapshots;
  `data/legacy/` stores legacy follower files and comparison reports.
- `data/slash-audit/` stores the slash-command audit.
- `data/reblog-cache.json` stores shared cached reblog results and rate-limit
  cooldown information.

On Windows, the root folder has shortcuts to each data folder. If you move or
copy the project, recreate them from the new location with
`npm run create-shortcuts`. The shortcuts are local to this computer and are
not tracked in Git.

Standalone follower comparisons can be run with
`node scripts/missingNames.js <latest.json> <previous.json> [output.json]`.
If no output path is supplied, the report is saved in `data/legacy/`.

On the first start after this reorganization, the bot moves existing thread
files, follower snapshots, audit files, and legacy follower JSON into `data/`.
Stop any old bot process before starting the new version. Identical destination
files can be reused; if an existing destination differs, migration stops and
leaves both versions untouched for you to resolve. Restart after resolving any
conflict. Back up `data/` before moving or updating the bot; generated data can
contain private information. Data is ignored by Git except the two previously
tracked legacy files `missing_names.json` and `new_followers.json`.

## Private GitHub data backups on Windows

The optional backup script mirrors the entire `data/` folder to a **separate
private GitHub repository**. This includes threads, follower snapshots, legacy
data and the slash-command audit; it does not back up the bot code or `.env`.
The shared `data/reblog-cache.json` file is included when present.
Files named `.env` or `.env.*` and files ending in `.tmp` are skipped. The
script refuses symbolic links and credential-like filenames.

**Review the data before the first upload.** Backups are not encrypted; GitHub
and anyone with access to the private repository can read them. Filename checks
cannot detect credentials inside otherwise ordinary files: audit entries, for
example, contain command inputs and responses. Remove any credentials or other
information you do not want uploaded from `data/` first. Do not rely on this
script to find secrets. Git history retains old versions and deleted files;
deleting a secret in a later backup does not remove it from history. If a
credential is exposed, revoke or rotate it and address the repository history.
There is no automatic history retention limit. Keep a separate offline backup
as well.

### One-time setup

These steps use Node.js 18.17 or newer, Git for Windows and a GitHub account.
Replace the example paths and repository URL with your own:

1. On GitHub, create or use the **private** `tumblr-discord-bot-DATA`
   repository, initialized with a README. Do not use the bot's
   code repository. Keep the repository private and limit collaborator access.
2. Clone it **outside** the bot project, for example:

   ```powershell
   git clone https://github.com/YOURNAME/tumblr-discord-bot-DATA.git "C:\Users\YOURNAME\tumblr-discord-bot-DATA"
   ```

   Use this checkout only for backups. Its `data` directory is a mirror:
   tracked files there that no longer exist in the bot's `data` directory are
   removed from the latest commit, although they remain in Git history.
3. Configure Git's author identity if necessary:

   ```powershell
   git -C "C:\Users\YOURNAME\tumblr-discord-bot-DATA" config user.name "Your Name"
   git -C "C:\Users\YOURNAME\tumblr-discord-bot-DATA" config user.email "your-email@example.com"
   ```

   Authenticate Git Credential Manager for the same GitHub account, for example
   by running `git ls-remote https://github.com/YOURNAME/tumblr-discord-bot-DATA.git`
   and completing any sign-in prompt. The saved credential must have access to
   the private repository and its metadata. Scheduled runs cannot prompt for
   authentication. If sign-in or the privacy check fails, check your Git
   credential helper and repository permissions.
4. With the tracker idle, run this once from PowerShell:

   ```powershell
   node "C:\Users\YOURNAME\tumblr-discord-bot\scripts\backupData.js" "C:\Users\YOURNAME\tumblr-discord-bot-DATA" "https://github.com/YOURNAME/tumblr-discord-bot-DATA.git"
   ```

   The script checks the remote and confirms its GitHub visibility is private
   before copying or pushing. It refuses a dirty checkout or mismatched remote.
   JSON and JSONL are validated, data is read twice to detect changes, and
   copied and staged bytes are checked. This is not a transactional snapshot:
   avoid writes during backup, particularly changes spanning multiple files.
   Check the output, inspect the private repository on GitHub, and test a
   restore before relying on it.

You can also run the backup from the bot project directory using the npm
shortcut, passing your own checkout path and private repository URL:

```powershell
npm.cmd run backup -- "C:\Users\YOURNAME\tumblr-discord-bot-DATA" "https://github.com/YOURNAME/tumblr-discord-bot-DATA.git"
```

Add `--force` after the URL to run another backup on the same day. The path and
URL are arguments, not stored in `package.json`.

To run another manual backup on the same day, add `--force`:

```powershell
node "C:\Users\YOURNAME\tumblr-discord-bot\scripts\backupData.js" "C:\Users\YOURNAME\tumblr-discord-bot-DATA" "https://github.com/YOURNAME/tumblr-discord-bot-DATA.git" --force
```

This only bypasses the once-per-day skip; privacy and safety checks still run,
and Git does **not** force-push. If a forced push fails after a successful
backup earlier that day, retry manually with `--force`: scheduled runs will
still skip that day because of the earlier success.

### Schedule daily backups

1. Find the full path to Node with `where.exe node`. Open **Task Scheduler**,
   select **Create Task**, name it, and choose **Run only when user is logged
   on** under your Windows account.
2. Under **Triggers**, create an **At log on** trigger for that account. Under
   advanced settings, delay the task by **30 minutes**, then repeat every
   **1 hour** for **indefinitely**. Enable the trigger.
3. Under **Actions**, choose **Start a program**. Set **Program/script** to
   the full path to `node.exe`. Set **Add arguments** to:

   ```text
   "C:\Users\YOURNAME\tumblr-discord-bot\scripts\backupData.js" "C:\Users\YOURNAME\tumblr-discord-bot-DATA" "https://github.com/YOURNAME/tumblr-discord-bot-DATA.git"
   ```

   Set **Start in** to `C:\Users\YOURNAME\tumblr-discord-bot`.
4. Under **Settings**, choose **Do not start a new instance** if the task is
   already running, and enable **Run task as soon as possible after a scheduled
   start is missed**. Under **Conditions**, adjust the AC-power and sleep
   settings if you want backups while on battery. Save the task, select
   **Run**, and check **Last Run Result**. If the manual backup already
   succeeded today, this test run will skip rather than push again.

The first successful run on each local calendar day records success in the
backup checkout's `.git` directory; later runs that day skip. A failed push is
not marked successful, so the next scheduled run retries it. Sleep, being
logged out, lack of network, or expired credentials can delay backups. Check
Task Scheduler's last result regularly; if it reports failure, run the manual
command above to see the error. The task does not send notifications.

If a backup is interrupted, confirm no backup is still running before removing
`tumblr-backup.lock` from the backup checkout's `.git` directory. A failure
before the commit may leave changes staged or unstaged; the script will refuse
to continue until the checkout is clean. Inspect and preserve any needed
changes, then resolve them manually or use a fresh clone. Never discard changes
without checking them. A failed push after a commit leaves that commit locally
for the next retry.

### Restore

Stop the bot. Clone the private backup into a new directory, disabling Git's
automatic line-ending conversion to preserve the saved file bytes:

```powershell
git clone --config core.autocrlf=false https://github.com/YOURNAME/tumblr-discord-bot-DATA.git "C:\Users\YOURNAME\tumblr-data-restore"
```

The latest remote commit contains the latest successfully pushed mirror; use
Git history in the restore checkout to select an earlier version if needed.
Preserve or rename the existing project `data` directory, then copy the restore
checkout's `data` directory into the project as `data`. Check the files before
restarting the bot. `.env` and other excluded files must be restored separately.

## Follower command

Set `BLOG_NAME` in `.env` to choose the default blog for the
`$tumblrcracker` Discord command. If it is unset or blank, the default is
`iobartach`. To use another blog for a single request, run
`$tumblrcracker blog-name`; the supplied name takes precedence.

## Tracked threads

The local thread tracker lists saved Tumblr posts and their most recent reblogger
and reblog date. It uses Tumblr's post notes, so the latest reblog may be from
**any branch** of a post, not necessarily a reply from your roleplay partner.
Likes and replies are not counted as reblogs. If there are no reblogs, the view
shows the saved post's author and date, labeled "Saved post (no reblogs)".
The saved post may itself be a reblog, not the original post in the thread.
Fetching these details requires an additional Tumblr post lookup; inaccessible
posts, rate limits, and other API errors are shown separately.

1. Install dependencies with `npm install`. Configure `CONSUMER_KEY` in `.env`
   with the OAuth consumer key from your [Tumblr application](https://www.tumblr.com/oauth/apps).
   The existing Discord bot configuration is still needed to run the bot.
2. From the project directory, start the bot with `node index.js`, then open
   [http://localhost:3000/threads/](http://localhost:3000/threads/).
3. Enter who you are writing with and, optionally, a story name; the page
   formats the title as `w/ partner | story name`, using `n/a` when the story
   name is blank. The story name uses your browser's spellchecker, if available.
   Enter the post ID and the blog that published
   that particular post, or paste its link into **Paste post URL** to fill
   both fields automatically. Alternatively, choose **Post URL** and enter its
   URL instead.
   Post ID is the default; choose a different default in the header settings.
   The blog defaults to `BLOG_NAME` from `.env`, or `iobartach` when unset;
   you can change it per post. Tumblr verifies post-ID entries before they are
   saved, so an API key and a publicly accessible post are required. A missing,
   restricted, or wrong-blog post is not saved. URL entries retain their
   existing behavior and are not checked until reblogs are fetched.
   Select **Track thread**, use **Refresh** to fetch current reblogs, **Edit**
   to change a saved title or post reference, or **Remove** to stop tracking a
   post. When editing, **Cancel edit** discards unsaved changes. An unchanged
   post ID does not need to be verified again. Existing titles that do not
   follow the `w/ partner | story name` format appear in the story field and
   are preserved; add a partner to convert them to the new format.
   If a post is already tracked, the message identifies the matching thread
   and links to the post without clearing the form.

Use **Open random thread** to open a matching thread's latest reblog in a new
tab. If the reblog link is unavailable, it opens the saved post instead. It
respects the current filters and chooses from all matching pages, not just the
page on screen. The button is unavailable while threads are loading or when
nothing matches.

Use **Saved asks** to manually save Tumblr ask links with an optional note. The
button counts the links remaining in the list, not the contents of your Tumblr
inbox. The list shows five asks per page. Open a link while logged in to Tumblr;
**Answered** and **Remove** both remove it from this list only and do not change
Tumblr. No Tumblr API calls are
made to save or list asks. Links are not verified and may stop working after an
ask is answered or removed on Tumblr. Each configured blog has its own list in
`data/threads/asks_<blog-name>.json`, included in the private data backup.

Use the **gear** in the header to change the accent colour, text size, table
density, default page size, default post reference and writing-partner
highlights. You can hide the header image, upload a replacement (PNG, JPEG,
WebP or GIF, up to 2 MB), or restore the default. Save to apply changes; changing the table's page-size
filter remains temporary. Settings and uploaded images are stored only in this
browser for this address, not in `data/` or its backup. Clearing browser data
removes them. Browser storage must be available and have enough space.

Use **Search ID** to open a Google search for the saved post ID on Tumblr.
Google receives the ID only when you click the link; results depend on what
Google has indexed and may not reveal earlier posts in the trail.

Use **Find trail** to open the saved post on Tumblr while logged in, or request
its available earlier posts using the public Tumblr API. **Try authenticated
lookup** uses the Tumblr account authorized via **Authorize Tumblr**; configure
`CONSUMER_KEY` and `CONSUMER_SECRET` in `.env`, then authorize in the same
browser. The access token stays in memory and needs reauthorization after a
restart or expiry. The authenticated endpoint may reject posts the account
cannot access. Trail entries can be absent, removed, deleted or incomplete;
some entries lack a usable blog name or post ID. The lookup does not search
other branches and does not change the tracked post.

Click a table column heading to sort ascending; click it again to sort
descending. The displayed saved-post author and date are used for sorting
when no reblogs exist. Rows without a known author or date sort last. In **Filters**,
enable **Show only threads last reblogged by another blog** to exclude
`BLOG_NAME` (or its `iobartach` fallback). This also hides rows with no reblog,
loading results, or errors because their last reblogger is unknown.

Use the thread title and last reblogger search fields for case-insensitive
partial matches. The reblogger search uses the displayed saved-post author
when there are no reblogs; loading or failed lookups do not match until an
author is known. These searches combine with the other filters.
Long titles, AU names, blog names and dates can be truncated in the table;
hover over them to see them in full. Searching and sorting still use the full
values. On narrower screens, scroll the table horizontally to see all columns.

The writing partner filter groups matching partner names case-insensitively.
Threads sharing a partner are highlighted, even if other filters hide some
of them. Each formatted thread has an internal per-partner number in the JSON;
numbers are assigned to existing entries when their collection is first opened,
and stay unchanged when only the story or post reference is edited. Titles
without the `w/ partner | story name` format are preserved but do not appear
in the partner filter. Stop old bot processes before starting this version so
they cannot overwrite the new numbers.

Choose 5, 10, 25, 50, or 100 records per page and use **First**, **Previous**,
**Next**, and **Last** to navigate the filtered, sorted results. Reblog details
for all pages are loaded so sorting and filtering can use them.

The web tracker and `/thread latest` share `data/reblog-cache.json`, including
across bot restarts. A successful lookup is reused for one hour; after that,
the next page load, **Refresh**, or `/thread latest` checks Tumblr again. The
display shows when the information was last checked. Refresh does not bypass
the one-hour cache. Requests for the same post are combined, and Tumblr
requests for reblog lookups are made one at a time, at least one second apart.
A first load with many uncached threads can therefore take a while.

If Tumblr returns HTTP 429, further reblog lookups pause until its `Retry-After`
time, or for 15 minutes when it provides no usable time. The pause survives a
restart. Other failed lookups wait one minute before retrying. When an older
result exists, it is shown with its last-check time and a warning; without a
cached result, the error is shown instead. Refresh again after the pause:
there is no background polling. Adding a post by ID, trail lookups and other
Discord commands make their own API calls and do not use this reblog cache or
its queue. The cache may retain results for removed threads; stop the bot before
editing or deleting it. Deleting it also clears the locally recorded cooldown.

Tick the checkbox next to a thread to mark it completed; untick it to return
it to ongoing. You can also change completion while editing the thread; the
change is saved with the rest of the form. The star independently toggles
whether it is a favourite.
Use **Filter by status** for ongoing, completed, or favourite threads, or show
all threads. **Show starred threads first** groups favourites ahead of other
results while preserving the selected sort within each group. These controls
combine with the other filters. New and existing threads start ongoing and
unstarred. Completed threads remain in the same JSON collection, rather than
being moved or deleted, and continue to appear in Discord thread commands.

Use **Manage AUs** to add, edit, or delete alternate universes. Each AU can
optionally have a short name (up to 50 characters) and an HTTP or HTTPS link
to verse information. The link opens from the AU manager. Existing AUs need
not have either field. Select one
optional AU when adding or editing a thread; the table displays it and the AU
filter can show a particular AU or unassigned threads. The filter uses the
full AU name; the table displays its short name when available, otherwise its
full name. Existing threads remain
unassigned until edited. An AU must be unassigned from all threads before it
can be deleted. Each configured blog has its own AU list in
`data/threads/aus_<blog-name>.json`; assignments are stored in that blog's
thread collection. Back up both files together and edit them only while the
server is stopped.

The tracker stores a separate collection for each configured `BLOG_NAME` in
`data/threads/tracked_threads_<blog-name>.json`. The blog name is
case-insensitive; a missing or blank name uses `iobartach`. The collection
belongs to the configured blog, regardless of which blog published a saved
post. The web view and `/thread` commands share this collection.

The first time a collection is opened after this update, existing
`tracked_threads.json` entries are copied into the current blog's collection
if it does not already exist. The original file is left intact as a backup.
`tracked_threads.migration.json` records that one-time migration; keep it and
all collection files when moving or updating the bot. Edit collection files
only while the server is stopped.

To switch collections, edit `BLOG_NAME` in the `.env` file in the bot's working
directory, then click **Refresh** on the thread page. No bot restart is needed
for the tracker or `/thread` commands. A stale page must refresh before making
changes. If `.env` has no `BLOG_NAME`, the tracker uses the process environment
value supplied at startup, or the fallback. Other configuration and commands
still use their existing startup environment behavior.

Supported URLs include
`https://www.tumblr.com/blog-name/123456789/optional-slug` and
`https://blog-name.tumblr.com/post/123456789/optional-slug`.
Post IDs are kept as strings to preserve their full precision.
The tracker follows reblogs of the specific saved post, not necessarily every
branch of the original root post.

The tracker is intended for local, trusted use. The existing server has no
access control, so do not expose it to the internet or an untrusted network.
The tracker uses the API key for public posts and does not guarantee access to
private, deleted, or otherwise restricted posts.

Run the tracker tests with `npm test`.

## Discord slash commands

Slash commands are Discord's built-in command picker: type `/` in a server
where the bot is installed, choose a command and fill in its options. The new
commands are in `src/discord/slashCommands.js`; the existing `$` commands remain available.

1. In `.env`, set `DISCORD_CLIENT_ID` to your Discord application's ID,
   `DISCORD_CLIENT_SECRET` to the **bot token** (the legacy variable name),
   and `DISCORD_OWNER_ID` to your own Discord user ID. In Discord, enable
   Developer Mode, right-click your account and select **Copy User ID**.
   Never share the token. If `DISCORD_OWNER_ID` is missing or incorrect, the
   slash commands deny access rather than allowing everyone.
2. Ensure the bot is installed in your server with the `applications.commands`
   scope. Run `npm run register-commands` from the project directory to
   register `/thread`, `/blog`, and `/followers` globally. Registration updates
   those named commands without replacing other commands; Discord may take
   some time to show global updates. Re-run registration after changing command
   definitions.
3. Restart with `node index.js`, then type `/thread` in Discord. Only the configured
   owner can run these new commands. Successful responses and errors are
   **visible to the channel**, including follower comparison attachments.
   Run sensitive commands only in a private channel. Discord messages persist
   subject to server policies, permissions and deletion; ephemeral responses to
   denied users remain private. The owner restriction does **not** apply to the
   older `$` commands or web page.

The bot writes an audit trail to `data/slash-audit/commands.jsonl`, ignored by Git.
It records timestamps, user/channel/guild and interaction IDs, command options,
outcomes, response text and attachment filenames, but not attachment contents.
URL query strings and fragments are omitted from logged inputs. Do not enter
tokens or other secrets in command fields: free-text inputs are logged.
Entries are kept until manually deleted. Treat the log and backups as sensitive:
they can contain thread titles, blog names and follower counts. Protect access
to the directory; permissions depend on your operating system. If the log cannot
be started, the command is not run; a later logging failure is reported in
Discord. A `started` entry without a `completed` entry can indicate a crash,
and `delivery_failed` indicates a response could not be delivered.

Available commands:

- `/thread add` saves a title and Tumblr post URL in the same list as the web
  view; `/thread list` displays it with an optional page number.
- `/thread latest` checks the newest reblog of a tracked URL; `/thread remove`
  requires `confirm: true`. Latest reblogs can come from any branch.
- `/blog recent` lists up to five recent public posts. Its optional blog name
  defaults to `BLOG_NAME` (or `iobartach`); public Tumblr lookups require
  `CONSUMER_KEY`.
- `/followers snapshot` fetches the blog's followers using Tumblr OAuth 1.0a
  credentials `CONSUMER_KEY`, `CONSUMER_SECRET`, `OAUTH_KEY`, and
  `OAUTH_SECRET`. The credentials must be authorized for that blog. It stores
  names locally under `data/follower-snapshots/`, which is ignored by Git.
  `/followers compare` compares the latest two slash-command snapshots for
  that blog and returns a JSON attachment **visible to the channel**, including
  follower names. Existing follower files from
  the legacy `$tumblrcracker` command are not imported.

Snapshots can contain sensitive data. Limit access to the project folder and
backups; local file permissions depend on your operating system. There is no
automatic deletion: remove unwanted snapshot files yourself. The snapshot
operation rejects missing pages and changing counts. If Tumblr returns duplicate
names, it retries once when time permits; if duplicates persist, it saves unique
names and marks the snapshot as potentially incomplete. The command and future
comparisons warn about this, since the list might be missing followers.
Tumblr can also change while pagination is in progress, so even snapshots
without duplicate warnings are best-effort. Missing names
in a comparison may reflect a rename or deactivation, not necessarily an
unfollow. Very large or rate-limited snapshots can fail without saving partial
data. Scheduled notifications are not included.

## Future improvements

- Investigate and test using the Discord bot in a private one-to-one direct
  message, including command availability, permissions and privacy. DM support
  has not yet been verified.
