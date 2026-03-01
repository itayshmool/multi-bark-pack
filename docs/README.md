# multi-bark-pack

> **Forked from [bark-pack](https://github.com/KobiAms-Wix/bark-pack) by [KobiAms-Wix](https://github.com/KobiAms-Wix)**

Multi-platform, multi-backend AI agent swarm. Send a message in WhatsApp, Telegram, or Slack and get a persistent coding agent ("pup") that lives in a tmux session on your machine. Supports multiple LLM backends: Claude Code, Cursor, and more. Each pup remembers its full conversation history across messages and survives restarts.

> **Platform note:** multi-bark-pack is developed and tested on macOS with Homebrew. Linux should work but paths may differ. Contributions welcome.

## Table of contents

- [Supported Backends](#supported-backends)
- [How it works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Platform setup guides](#platform-setup-guides) — [Telegram](#option-a-telegram-easiest-to-set-up) | [WhatsApp](#option-b-whatsapp) | [Slack](#option-c-slack)
- [Multiple owners](#multiple-owners)
- [Using bark-pack](#using-bark-pack)
  - [Routing](#routing)
  - [Commands](#commands)
  - [Backend and model switching](#backend-and-model-switching)
  - [Voice messages](#voice-messages)
  - [Name packs](#name-packs)
  - [Admin UI dashboard](#admin-ui-dashboard)
  - [Cross-backend skills](#cross-backend-skills)
  - [Pup delegation](#pup-delegation)
  - [Security guard](#security-guard)
  - [Agent fallback](#agent-fallback)
- [Status indicators](#status-indicators)
- [Troubleshooting](#troubleshooting)
- [Project structure](#project-structure)

## Supported Backends

| Backend | Status | CLI | Session Persistence |
|---------|--------|-----|---------------------|
| Claude Code | ✅ Active | `claude` | ✅ |
| Cursor | ✅ Active | `cursor` | ✅ |
| OpenAI Codex | ✅ Active | `codex` | ✅ |
| Google Gemini | ✅ Active | `gemini` | ✅ |

All backends support automatic failover — if one fails, bark-pack can switch to another while preserving conversation context.

## How it works

```
You send a message ──> bark-pack spawns a pup ──> pup runs Claude Code in tmux
                                                        |
You get live updates <── pup streams progress <─────────┘
```

Every new message spawns a new pup. Replies to a pup's message route back to that pup. You can also `@mention` a pup by name. Pups can clone repos, write code, run tests, and send files back to your chat.

---

## Prerequisites

Run the prerequisites script to check and install everything automatically:

```bash
./scripts/prerequisites.sh
```

**For Wix employees** (uses internal npm registry):

```bash
./scripts/prerequisites-wix.sh
```

Both scripts check: Homebrew, Node.js 18+, yarn, tmux, Claude Code CLI, ffmpeg, whisper-cpp — and run `yarn install`. Pass `--yes` to auto-accept required installs (for CI).

**Additional LLM backends** (Cursor, Codex, Gemini) — install, authenticate, and auto-configure `.env`:

```bash
./scripts/install-backends.sh
```

<details>
<summary>Manual installation (if you prefer not to use the script)</summary>

### 1. Node.js (v18 or higher)

```bash
# Check your version
node --version   # must show v18.x.x or higher

# Install on macOS (if not installed)
brew install node

# Or download from https://nodejs.org/
```

### 2. yarn (package manager)

```bash
# Check if installed
yarn --version

# Install globally via npm
npm install -g yarn
```

### 3. tmux (terminal multiplexer)

Each pup runs in its own tmux session. This is how bark-pack keeps pups alive in the background.

```bash
# Check if installed
tmux -V

# Install on macOS
brew install tmux
```

### 4. LLM Backend CLI (at least one)

You need at least one AI backend installed and configured.

**Claude Code (default):**
```bash
# Install globally
npm install -g @anthropic-ai/claude-code

# Log in (opens your browser)
claude auth login

# Verify it works
claude --version
```

**Cursor (optional):**
```bash
# Install via the Cursor app or CLI installer
# Verify it works
cursor --version
```

**OpenAI Codex (optional):**
```bash
# Install globally
npm install -g @openai/codex

# Verify it works
codex --version
```

**Google Gemini (optional):**
```bash
# Install globally
npm install -g @anthropic-ai/gemini-cli

# Verify it works
gemini --version
```

Configure which backends are enabled in `.env`:
```env
DEFAULT_BACKEND=claude-code
ENABLED_BACKENDS=claude-code,cursor,codex,gemini
```

### 5. ffmpeg + whisper.cpp (optional — for voice messages)

Only needed if you want to send voice messages and have them transcribed to text. Transcription runs 100% locally — no cloud API, no cost.

```bash
# One-liner: installs ffmpeg, whisper-cpp, and downloads the multilingual model
./scripts/install-whisper.sh
```

Or manually:
```bash
brew install ffmpeg whisper-cpp
mkdir -p /opt/homebrew/share/whisper-cpp/models
curl -L -o /opt/homebrew/share/whisper-cpp/models/ggml-base.bin \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
```

The default model is `ggml-base.bin` (multilingual — supports Hebrew, English, and 90+ languages with auto-detection). Override the path in `.env` if needed.

</details>

---

## Quick start

```bash
git clone <repo-url>
cd multi-bark-pack
./scripts/prerequisites.sh    # checks & installs system deps + yarn install
```

### Option 1: Setup Wizard (recommended)

The setup wizard walks you through backend installation, authentication, and channel configuration — all from your browser.

```bash
yarn setup
```

Open **http://localhost:3334** and follow the 7-step wizard:

1. **Welcome** — overview
2. **Prerequisites** — auto-detects Node, tmux, ffmpeg, whisper; install missing with one click
3. **Backend Selection** — pick and install LLM backends (Claude Code, Cursor, Codex, Gemini)
4. **Backend Auth** — verify each backend works; device auth for Codex, API key for Gemini
5. **Channels** — configure Telegram, WhatsApp, or Slack with test buttons
6. **Advanced** — default backend, timeout, fallback settings
7. **Review & Launch** — saves your `.env` and starts the server

### Option 2: Manual setup

```bash
cp .env.example .env
```

Edit `.env` with your platform credentials (follow **one** of the platform guides below), then:

```bash
yarn start                         # run on the current directory
yarn start --path=/path/to/repo    # run on a specific repo
```

You only need **one** platform to get started. Pick whichever you already use.

`yarn start` runs `scripts/start.sh`, which handles everything: preflight checks (node, tmux, build), repo symlink into `projects/`, and auto-restart loop. Exit code 0 (e.g. `/restart` command) restarts after 3s. Non-zero exit (crash or `/shutdown`) stops for real.

---

## Platform setup guides

### Option A: Telegram (easiest to set up)

Telegram only needs a bot token — no phone scanning, no OAuth apps, no browser auth.

#### Step 1: Create your bot with BotFather

1. Open Telegram on your phone or desktop
2. Search for **@BotFather** and open a chat with it (it has a blue checkmark)
3. Type `/newbot` and send
4. BotFather asks: **"Alright, a new bot. How are we going to call it?"**
   - Reply with a display name, e.g. `My Bark Pack` (this can have spaces)
5. BotFather asks: **"Good. Now let's choose a username for your bot."**
   - Reply with a username ending in `bot`, e.g. `my_bark_pack_bot` (no spaces, must end in `bot`)
6. BotFather replies with a message containing your **bot token**:
   ```
   Use this token to access the HTTP API:
   7123456789:AAHfGxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
7. **Copy this token** — you'll paste it into `.env` in Step 5

#### Step 2: Create a Telegram group

1. In Telegram, tap the pencil/compose icon > **New Group**
2. Name it whatever you want (e.g. "bark-pack")
3. Add your bot as a member by searching for its username (e.g. `@my_bark_pack_bot`)
4. Create the group

#### Step 3: Make the bot an admin

The bot needs admin rights to pin the status message.

1. Open your group > tap the group name at the top
2. Tap **Edit** (pencil icon) > **Administrators** > **Add Administrator**
3. Select your bot
4. Enable at least: **Pin Messages**, **Delete Messages**
5. Tap **Done** / **Save**

#### Step 4: Get your chat ID and user ID

**Chat ID** (identifies your group):

1. Add the bot **@RawDataBot** to your group (search for it and add as member)
2. It instantly sends a message with JSON data
3. Look for the line: `"chat": { "id": -100XXXXXXXXXX, ...`
4. That number (including the minus sign `-100...`) is your chat ID
5. Remove @RawDataBot from the group — you don't need it anymore

**Your user ID** (so bark-pack only responds to you):

1. Open a private chat with the bot **@userinfobot** (search for it)
2. Send any message (like "hi")
3. It replies with your info, including: `Id: 123456789`
4. That number is your user ID

#### Step 5: Edit your .env file

Open `.env` in a text editor and set these three values:

```env
TELEGRAM_TOKEN=7123456789:AAHfGxxxxxxxxxxxxxxxxxxxxxxxxxxx
TELEGRAM_CHAT_ID=-100XXXXXXXXXX
TG_OWNER=123456789
```

#### Step 6: Start bark-pack

```bash
yarn start
```

Send a message in your Telegram group. You should see the bot reply within a few seconds.

> **Tip:** If you leave `TELEGRAM_CHAT_ID` blank, the bot will auto-detect it from the first group message and save it. But setting it explicitly is more reliable.

---

### Option B: WhatsApp

WhatsApp uses [whatsapp-web.js](https://github.com/nicedayfor/whatsapp-web.js) which simulates WhatsApp Web. It requires scanning a QR code on first launch (like linking a new device).

#### Step 1: Create a WhatsApp group

1. Open WhatsApp on your phone
2. Tap **New Group**
3. Add at least one contact (you can remove them later, or keep them)
4. Name it `bark-pack` (this must match `WA_GROUP` in `.env`)

#### Step 2: Find your owner ID

Your WhatsApp owner ID is your phone number in international format **without the `+` sign**:

| Your phone number | Owner ID |
|---|---|
| +1 (555) 123-4567 | `15551234567` |
| +972 50-123-4567 | `972501234567` |
| +44 7911 123456 | `447911123456` |

Just digits, no spaces, dashes, or plus sign.

#### Step 3: Edit your .env file

```env
WA_ENABLED=true
WA_GROUP=bark-pack
WA_OWNER=972501234567
```

#### Step 4: Start and scan QR

```bash
yarn start
```

1. A QR code appears in your terminal
2. On your phone: WhatsApp > **Settings** > **Linked Devices** > **Link a Device**
3. Scan the QR code from your terminal
4. Wait a few seconds — the bot should confirm it's connected

The session is saved in `.wwebjs_auth/` so you won't need to scan again unless you delete that folder.

> **If the QR code doesn't appear or the bot stops responding:** Delete the `.wwebjs_auth/` and `.wwebjs_cache/` folders, restart with `yarn start`, and scan the QR again.

---

### Option C: Slack

Slack requires creating a Slack App with Socket Mode. This takes ~5 minutes.

#### Step 1: Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) in your browser
2. Click the green **"Create New App"** button
3. Choose **"From scratch"**
4. Enter an app name (e.g. `bark-pack`) and select your workspace
5. Click **"Create App"**

You're now on your app's settings page. Keep this tab open.

#### Step 2: Enable Socket Mode

Socket Mode lets the bot receive messages without a public URL.

1. In the left sidebar, click **"Socket Mode"**
2. Toggle the switch to **"Enable Socket Mode"** (it turns green)
3. A popup asks you to create a token. Name it anything (e.g. `bark-pack-socket`)
4. Under scopes, add: `connections:write`
5. Click **"Generate"**
6. You'll see a token starting with `xapp-1-...` — **copy it**. This is your `SLACK_APP_TOKEN`

#### Step 3: Set up bot permissions

1. In the left sidebar, click **"OAuth & Permissions"**
2. Scroll down to **"Bot Token Scopes"**
3. Click **"Add an OAuth Scope"** and add each of these one by one:
   - `chat:write` — lets the bot send messages
   - `channels:history` — lets the bot read messages in public channels
   - `channels:read` — lets the bot see channel list
   - `groups:history` — lets the bot read messages in private channels
   - `groups:read` — lets the bot see private channel list
   - `im:history` — lets the bot read direct messages
   - `im:read` — lets the bot see DM list
   - `im:write` — lets the bot open DM conversations
   - `pins:write` — lets the bot pin the status message
   - `pins:read` — lets the bot read pins
   - `users:read` — lets the bot look up user names
   - `reactions:write` — lets the bot add emoji reactions
   - `files:read` — lets the bot download shared files

#### Step 4: Set up event subscriptions

1. In the left sidebar, click **"Event Subscriptions"**
2. Toggle **"Enable Events"** to ON
3. Scroll down to **"Subscribe to bot events"**
4. Click **"Add Bot User Event"** and add:
   - `message.channels` — messages in public channels
   - `message.groups` — messages in private channels
   - `message.im` — direct messages
   - `app_mention` — when someone @mentions the bot
5. Click **"Save Changes"** at the bottom

#### Step 5: Enable the Messages tab

1. In the left sidebar, click **"App Home"**
2. Scroll down to **"Show Tabs"**
3. Check **"Allow users to send Slash commands and messages from the messages tab"**

#### Step 6: Install the app to your workspace

1. In the left sidebar, click **"Install App"**
2. Click **"Install to Workspace"**
3. Review the permissions and click **"Allow"**
4. You'll see a **"Bot User OAuth Token"** starting with `xoxb-...` — **copy it**. This is your `SLACK_BOT_TOKEN`

#### Step 7: Invite the bot to a channel

In Slack, go to any channel and type:

```
/invite @bark-pack
```

(Use whatever name you gave your app in Step 1.)

#### Step 8: Find your Slack user ID

1. In Slack, click on your own name or avatar
2. Click **"View full profile"** (or "Profile")
3. Click the **three dots (...) menu**
4. Click **"Copy member ID"**
5. It looks like `U0A1B2C3D4E`

#### Step 9: Edit your .env file

```env
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_APP_TOKEN=xapp-1-your-token-here
SLACK_OWNER=U0A1B2C3D4E
```

#### Step 10: Start bark-pack

```bash
yarn start
```

Send a message in the channel where you invited the bot. It should reply.

---

## Multiple owners

You can let multiple people control the pups by providing comma-separated IDs:

```env
TG_OWNER=123456789,987654321
WA_OWNER=15551234567,15559876543
SLACK_OWNER=U0123456789,U07B2K3LFMN
```

To allow **everyone** in the group (use with caution — anyone can spawn agents on your machine):

```env
TG_OWNER=DANGER-ALL
```

---

## Using bark-pack

Once the server is running, just send a message in your group/channel. bark-pack spawns a pup and replies.

### Routing

Messages are routed by priority:

1. **Reply to a pup's message** — routes to that pup
2. **@Name message** — `@Chase fix this bug` routes to Chase
3. **New message** — spawns a new pup

### Commands

| Command | What it does |
|---------|-------------|
| `/help` | Show command list |
| `/status` | Refresh the pinned status message |
| `/backends` | Show available LLM backends and their status |
| `/skills` | Show available cross-backend skills |
| `/skill name @pup` | Add a skill to a pup |
| `/daily` | Request a one-line standup from every pup |
| `/stop name` | Stop a running pup (sends Ctrl+C) |
| `/stop pack` | Stop all running pups |
| `/clear name` | Shelve a pup (deactivate — can bring back with `/reborn`) |
| `/clear pack` | Shelve all pups |
| `/delete name` | Permanently remove a pup (frees the name, no undo) |
| `/delete pack` | Permanently remove all pups (active + shelved) |
| `/reset name` | Wipe a pup's memory (stays active, starts fresh) |
| `/reset pack` | Wipe all pup memory |
| `/create` | Reply to a message with `/create` to spawn a pup with that context |
| `/create @name` | Same as above, but name the pup (e.g. `/create @Fido`) |
| `/losts` | List shelved pups available for resurrection |
| `/reborn name` | Bring back a shelved pup with its full history |
| `/purge` | Permanently delete all shelved pups (frees all names) |
| `/restart` | Restart the server (auto-restarts via scripts/start.sh) |
| `/shutdown` | Shut down the server (no auto-restart) |

### Backend and model switching

Add `#claude-code`, `#cursor`, `#codex`, or `#gemini` to select a backend for a new pup:

```
#cursor fix this CSS bug                → new pup using Cursor
#gemini summarize this file             → new pup using Gemini
```

Add `#haiku`, `#sonnet`, or `#opus` to switch a pup's model:

```
#opus build me something complex        → new pup with Opus
@Chase #haiku quick question             → switches Chase to Haiku
#cursor #opus fix this bug               → Cursor backend with Opus model
```

The model persists for that pup until you change it again.

### Voice messages

Send a voice message in the chat and bark-pack transcribes it locally using whisper.cpp, then routes the text to a pup. Supports **Hebrew, English, and 90+ languages** with automatic language detection. Transcription is 100% local — no cloud API, no cost. Requires ffmpeg and whisper.cpp (see [prerequisites](#prerequisites) or run `./scripts/install-whisper.sh`).

### Name packs

Pups get names from configurable "name packs". The default pack is Paw Patrol (Chase, Marshall, Skye...). Built-in packs include:

| Pack | Theme | Icon |
|------|-------|------|
| Paw Patrol | Rescue pups | 🐾 |
| Mario Kart | Racing characters | 🍄 |
| Pokemon | Starter Pokemon | ⚡ |
| Israeli Ministers | Government officials | 🇮🇱 |

Each pack has 32 names and 32 adjectives (1,024 combinations). Switch packs or create custom ones via the Admin UI.

### Admin UI dashboard

bark-pack includes a web dashboard for managing pups and configuration.

```bash
# Default: http://localhost:3333
```

Features:
- Live agent status with backend indicators
- Start/stop/clear/delete agents
- Chat panel — send messages and view conversation history
- View agent details (session ID, working directory, history)
- Activity timeline with real-time event feed (filterable by pup, backend, event type)
- Cost/usage dashboard per agent
- Manage name packs (view, edit, create custom packs)
- Backend status overview
- Parent/sub-agent relationships visible on agent cards

Set `UI_PORT` in `.env` to change the port. Optionally set `API_SECRET` to require login:

```env
API_SECRET=your-secret-here
```

When set, visiting the dashboard shows a login page. The cookie lasts 30 days.

### Cross-backend skills

Skills are reusable prompt modules that work across all backends. They're loaded once at server startup for zero runtime overhead.

```bash
/skills                    # List available skills
/skill developer @Chase    # Add developer skill to Chase
```

Built-in skills:

| Skill | Description | ~Tokens |
|-------|-------------|---------|
| `developer` | Senior developer mode - implementation focus | 342 |
| `reviewer` | Code review mode - bugs, security, maintainability | 374 |
| `architect` | System design mode - patterns, scalability | 685 |
| `product` | Product manager mode - user focus, requirements | 405 |
| `debug` | Debug mode - hypothesis-driven investigation | 420 |
| `add-backend` | Scaffold a new LLM backend | 867 |

Skills are stored in `.claude/skills/` as SKILL.md files (YAML frontmatter + markdown). Create custom skills by adding new directories there.

### Pup delegation

Pups can spawn independent sub-agents to handle parallel tasks. This is "delegate and forget" — the sub-agent works autonomously and doesn't report back.

```
bark delegate "Build the landing page"              # soft — same branch
bark delegate "Add unit tests" --branch             # isolated branch + PR
```

Sub-agents automatically inherit their parent's context (conversation summary, working directory, modified files). In **soft mode** (default), the sub-agent works on the same branch with focused commits. In **branch mode**, it creates its own branch (`bark/<name>`) and opens a PR when done.

Guardrails:
- Max 1 level deep (sub-agents can't delegate further)
- Max 3 active sub-agents per parent
- Sub-agents appear in chat, admin UI, and status message (tagged with `↳ParentName`)

Configure via:
```env
MAX_DELEGATION_DEPTH=1
MAX_SUB_AGENTS=3
```

### Security guard

Incoming messages from external adapters (Telegram, WhatsApp, Slack) are optionally screened before reaching any pup. The guard uses Claude Code CLI (`claude -p`) with Haiku to classify messages against 5 threat categories:

- **Personal data extraction** — credit cards, SSNs, passwords, API keys
- **Destructive commands** — `rm -rf /`, format disk, fork bombs
- **Prompt injection** — attempts to override system instructions or jailbreak
- **Fraud** — impersonation, social engineering, phishing
- **Malware** — viruses, ransomware, exploits, keyloggers

No API key needed — uses your existing Claude Code subscription. UI messages bypass screening. Blocked messages are logged to `.bark-tmp/security.log`.

```env
SECURITY_GUARD_ENABLED=true    # disabled by default
SECURITY_GUARD_FAIL_OPEN=true  # CLI errors allow messages through
```

### Agent fallback

When a pup hits an error (context window full, rate limit, timeout, crash), bark-pack automatically recovers:

1. **Retry** — Wait with exponential backoff, retry same session
2. **Reset** — New session on same backend with context injected
3. **Switch** — Switch to different backend with context injected

Context is preserved via server-side conversation history. Each turn is tracked and can be replayed into a new session if needed. Configure via:

```env
FALLBACK_ENABLED=true
AGENT_TIMEOUT=600000           # 10 min timeout
FALLBACK_MAX_RETRIES=3
FALLBACK_BACKEND_PRIORITY=claude-code,cursor,codex,gemini
```

### Watching pups work in real-time

Each pup runs in a tmux session. You can attach to watch them work live:

```bash
# List all pup sessions
tmux ls

# Watch a specific pup
tmux attach -t bark-Chase

# Detach (leave pup running): press Ctrl+B, then D
```

---

## Status indicators

The pinned status message uses these icons:

| Icon | Meaning |
|------|---------|
| `🔵` | **Running** — pup is actively working |
| `🟢` | **Idle** — pup finished, waiting for next message |
| `🔴` | **Yelp** — pup hit an error on its last run |
| `⚫` | **Nap** — pup's tmux session is gone (will be recreated automatically on next message) |

---

## Voice transcription config

Voice messages are transcribed locally — no cloud API, fully private. The default multilingual model supports Hebrew, English, and 90+ languages with automatic language detection.

```env
WHISPER_MODEL=/opt/homebrew/share/whisper-cpp/models/ggml-base.bin
```

Override this in `.env` if your model is elsewhere. To install whisper and the model, run `./scripts/install-whisper.sh`.

---

## Troubleshooting

### Bot ignores all messages

The `*_OWNER` env var is not set for your platform. This is the #1 issue. Check:
- Telegram: `TG_OWNER` must be set to your numeric user ID
- WhatsApp: `WA_OWNER` must be set to your phone number
- Slack: `SLACK_OWNER` must be set to your Slack member ID

Without an owner, the bot silently drops all messages.

### Telegram bot doesn't respond

1. Is the bot a **member** of the group? (Add it if not)
2. Is the bot an **admin**? (Needed for pinning messages)
3. Does `TELEGRAM_CHAT_ID` match your group? (Try leaving it blank — the bot auto-detects)
4. Does `TG_OWNER` match your user ID? (Check with @userinfobot)
5. Check the terminal running `yarn start` for error messages

### WhatsApp QR code doesn't appear

Delete these folders and restart:
```bash
rm -rf .wwebjs_auth .wwebjs_cache
yarn start
```
You'll need to scan the QR code again.

### Pup spawns but never responds

Attach to the pup's tmux session to see what's happening:
```bash
tmux attach -t bark-Chase
```
Look for Claude Code auth errors or permission issues.

### Pup is "yelping" (red dot)

The pup's last command exited with an error. Send it another message to try again, or use `/reset name` to wipe its memory and start fresh.

### "command not found" errors (tmux, claude, ffmpeg)

Make sure these tools are installed and on your PATH. bark-pack adds `/opt/homebrew/bin` to PATH automatically, but if you installed tools elsewhere, add their location to your shell profile (`~/.zshrc` or `~/.bashrc`).

### "CLAUDECODE" nesting error

You're running the server inside a Claude Code session. Run it in a regular terminal instead.

### Server crashes and doesn't restart

`yarn start` uses `scripts/start.sh` which only auto-restarts on clean exit (code 0). If the process crashes (non-zero exit), check the terminal output for the error and run `yarn start` again.

---

## Project structure

```
multi-bark-pack/
  src/                  TypeScript source (compiles to dist/)
    server/             Core: routing, agents, execution, API, WebSocket, commands, state
      index.ts          Entry point: wire dependencies, boot adapters, start HTTP
      routing.ts        Message routing: reply-to > @mention > spawn
      execution.ts      Build command, tmux exec, poll, deliver response
      commands.ts       All /slash command handlers
      agents.ts         Agent lifecycle: spawn, send, stop, clear, reset, reborn
      state.ts          In-memory state + persistence (agents.json, routing.json)
      api.ts            REST API routes
      websocket.ts      Real-time broadcasts to admin UI
    adapters/           Chat platforms: WhatsApp, Telegram, Slack
    backends/           LLM CLIs: Claude Code, Cursor, Codex, Gemini + shared utils
    stream-parsers/     JSON stream parsers per backend
    stream-display.ts   Standalone: backend output → .progress/.out/.done files
    history/            Per-agent conversation tracking + rolling summaries
    fallback/           Auto recovery: retry → reset → switch backend
    security/           Optional LLM-based message threat screening
    usage/              Cost and token tracking per agent/backend
    timeline/           Activity event log (JSONL + in-memory ring buffer)
    skills/             Cross-backend skill injection (SKILL.md files)
    config/             Path constants + tool icon registry
    utils/              Shared: error, tokens, text, tags, agent-files, atomic-write
    setup/              Interactive setup wizard (checks, backends, adapters, env)
    types/              All TypeScript type definitions
    test/               Test infrastructure
  scripts/              Shell scripts (setup, prerequisites, start)
  tools/                CLI helpers for pups (bark delegate)
  .claude/skills/       Skill definitions (SKILL.md files)
  ui/                   Web interfaces (admin dashboard, setup wizard)
  packs.json            Name pack definitions
  projects/             Where pups clone repos (auto-created, gitignored)
  .bark-tmp/            Runtime state files (auto-created, gitignored)
  .env                  Your configuration (not committed — copy from .env.example)
  .env.example          Template showing all available settings
  CLAUDE.md             Instructions for AI agents working on this codebase
  AGENTS.md             AI agent navigation guide
  tsconfig.json         TypeScript configuration
```

---

## License

MIT
