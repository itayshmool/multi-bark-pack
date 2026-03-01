# multi-bark-pack

Multi-platform, multi-backend agent swarm. Messages in WhatsApp, Telegram, or Slack spawn LLM agent CLI instances in tmux sessions. Supports multiple backends: Claude Code, Cursor, and more. Each agent ("pup") has a persistent conversation via session management.

## Stack

Node.js, whatsapp-web.js, @slack/web-api, @slack/socket-mode, tmux, whisper.cpp (voice transcription), ffmpeg

**Supported Backends:**
- Claude Code CLI (`claude`)
- Cursor CLI (`cursor`)
- OpenAI Codex CLI (`codex`)
- Google Gemini CLI (`gemini`)

## Files

- `server.js` — Main server: adapter manager, agent manager, message router
- `stream-display.js` — Parses streaming output, writes progress/output files
- `adapters/` — Chat platform adapters
  - `whatsapp.js` — WhatsApp adapter (whatsapp-web.js)
  - `telegram.js` — Telegram adapter (raw Bot API via fetch)
  - `slack.js` — Slack adapter (Socket Mode)
- `backends/` — LLM agent backends
  - `index.js` — Backend registry and initialization
  - `claude-code.js` — Claude Code CLI backend
- `stream-parsers/` — Output format handlers
  - `index.js` — Parser registry
  - `claude.js` — Claude stream-json parser
- `history/` — Server-side conversation tracking
  - `index.js` — History manager API
  - `storage.js` — JSON file storage per agent
  - `summarizer.js` — Context prompt building
- `fallback/` — Automatic agent recovery
  - `index.js` — Fallback orchestrator
  - `detector.js` — Failure classification
  - `injector.js` — Context injection
  - `config.js` — Configuration
- `security/` — Message security screening
  - `index.js` — Security guard: screens messages via Claude Code CLI (`claude -p`)
  - `prompt.js` — System prompt for threat classification
  - `logger.js` — Blocked message logging to `.bark-tmp/security.log`
- `usage/` — Cost and token usage tracking
  - `index.js` — Usage tracker: record, aggregate, query per-agent costs
  - `storage.js` — Atomic JSON storage to `.bark-tmp/usage.json`
- `timeline/` — Activity timeline: event capture, JSONL storage, real-time broadcast
  - `index.js` — Timeline API: emit events, in-memory ring buffer (500), getAll/getRecent
  - `storage.js` — JSONL append storage to `.bark-tmp/timeline.jsonl`
- `skills/` — Cross-backend skill system
  - `index.js` — Skills manager (loads once at startup)
  - `parser.js` — SKILL.md parser (YAML frontmatter + markdown)
- `mcp-config.json` — MCP server config: agents get these tools via `--mcp-config` (Claude Code, Cursor, Codex)
- `tools/bark` — CLI helper for pup delegation (`bark delegate "task"`)
- `.claude/skills/` — Skill definitions (Claude Code compatible)
- `prerequisites.sh` — System prerequisites checker/installer (Homebrew, Node, yarn, tmux, Claude CLI, ffmpeg, whisper)
- `prerequisites-wix.sh` — Wix variant: switches to internal npm registry, then runs prerequisites.sh
- `install-backends.sh` — Advanced backend installer: install, authenticate, verify all LLM backends + update .env
- `start.sh` — Auto-restart wrapper: exits 0 → restarts, non-zero → stops
- `agents.json` — Runtime state: active + soft-deleted agents (gitignored)
- `routing.json` — Message ID → agent ID map, all platforms (gitignored)
- `status.json` — Pinned status message IDs, persisted across restarts (gitignored)
- `.bark-tmp/` — Per-agent temp files: `.prompt`, `.out`, `.done`, `.progress`, `.cwd`, `.running`, `.sh`, `.sysprompt`, `.history.json` (gitignored)
- `.bark-tmp/{id}-send/` — Per-agent outbox: pups drop files here, server delivers via `sendFile()` (gitignored)
- `projects/` — Pup working directory: repos are cloned here (gitignored, auto-created)
- `docs/plans/` — Implementation plans

## Commands

```
yarn start              # Start the server (auto-restarts on clean exit)
node server.js          # Start without auto-restart wrapper
tmux ls                 # List active agent sessions
tmux attach -t bark-Chase  # Watch a specific pup work
```

### Commands (all platforms)

- `/status` — refresh pinned status message
- `/backends` — show available LLM backends and capabilities
- `/skills` — show available skills (cross-backend)
- `/skill name @pup` — add a skill to a pup
- `/stop name` — stop a running pup (sends Ctrl+C)
- `/stop pack` — stop all running pups
- `/clear name` — shelve pup (deactivate, can `/reborn`)
- `/clear pack` — shelve all pups
- `/delete name` — permanently remove pup (frees name, no reborn)
- `/delete pack` — permanently remove all (active + losts)
- `/reset name` — wipe pup memory (stays active, new session)
- `/reset pack` — wipe all pup memory
- `/losts` — list shelved pups available for resurrection
- `/reborn name` — resurrect a shelved pup with its full session history
- `/purge` — permanently delete all shelved pups (frees all names)
- `/create` — reply to a message to spawn a new pup with that context (optional: add instructions or `@name` to set the pup's name)
- `/daily` — request a one-line standup from every active pup
- `/stats` — show usage & cost summary (per-backend, per-pup)
- `/stats name` — show detailed stats for a specific pup
- `/help` — show command list
- `/restart` — restart the server (auto-restarts via start.sh)
- `/shutdown` — shut down the server without auto-restarting

Use `pack` instead of name for bulk operations (e.g., `/stop pack`, `/clear pack`, `/delete pack`, `/reset pack`).

**Multi-LLM:** Add `#claude-code`, `#cursor`, `#codex`, or `#gemini` to select backend. Add `#haiku`, `#sonnet`, or `#opus` to select model. Example: `#cursor #opus fix this bug`.

**Routing:** `@name msg` sends to a specific pup. Reply to a pup's message to continue. New messages spawn a new pup.

**Delegation:** Pups can spawn sub-agents via `bark delegate "task"`. Add `--branch` for isolated branch + PR.

## Architecture

```
Message (WhatsApp/Telegram/Slack) → Router → Backend (tmux + CLI)
Backend output → stream-parser → .progress/.out files → live-edited reply
```

### Backend Abstraction

Each backend implements:
- `isInstalled()` / `getVersion()` — availability check
- `buildCommand()` — generate CLI command for the agent
- `generateSessionId()` — create new session identifier
- `capabilities` — feature flags (streaming, sessions, etc.)

Agents are locked to their backend once spawned. `/reset` keeps the same backend.

**Routing priority:** reply-to > @name mention > spawn new agent

**Agent lifecycle:** Each agent runs the backend CLI with session management. Output streams through the appropriate parser which writes progress to `.bark-tmp/` for live message editing. System prompt is written to `.bark-tmp/{id}.sysprompt`. The full command is written to `.bark-tmp/{id}.sh` and executed via `bash` in the tmux pane.

**Working directory tracking:** Pups write their current working directory to `.bark-tmp/{id}.cwd`. The server reads this after each command completes and persists `agent.cwd`. If the directory no longer exists on disk, cwd resets to null.

**File sending:** Pups can send files to the user by copying them to `.bark-tmp/{id}-send/`. After the command finishes, the server delivers each file via `adapter.sendFile()`.

**Shelve (soft-delete):** `/clear` sets `status: 'deleted'` and preserves agent metadata + session ID. `/reborn` flips status back to `active` and uses resume with the original session.

**Reset:** `/reset` wipes a pup's memory (new session, clears cwd) while keeping the pup active and on the same backend.

**Naming:** First spawn uses bare Paw Patrol name (Chase, Marshall...). Once all 32 base names are taken (active or deleted), new pups get `adjective-Name` combos. 32 adjectives × 32 names = 1,024 combos.

**Status pin:** Pinned message updates on every significant event. `/status` forces a re-sync.

**Voice messages:** Voice messages are transcribed locally using whisper.cpp. Audio is converted to 16kHz WAV via ffmpeg, then transcribed.

**Model selection:** Add `#haiku`, `#sonnet`, or `#opus` anywhere in a message to switch that pup's model. Tag is stripped before routing. Model persists per pup.

**Agent Fallback:** Server tracks conversation history per agent. When agents fail (context window, rate limit, timeout, crash), automatic recovery kicks in:
1. **Retry** — Wait with exponential backoff, retry same session (for transient errors)
2. **Reset** — New session on same backend with context injected (for context window)
3. **Switch** — Switch to next backend with context injected (for persistent failures)

Context is preserved via rolling summaries + recent turns. History files stored in `.bark-tmp/{id}.history.json`.

**Security Guard:** Optional LLM-based screening for external adapter messages (Telegram, WhatsApp, Slack). Uses Claude Code CLI (`claude -p`) with Haiku to classify messages against 5 threat categories (personal data extraction, destructive commands, prompt injection, fraud, malware). Blocked messages are logged to `.bark-tmp/security.log`. UI messages bypass screening. No API key needed — uses your existing Claude Code subscription. Disabled by default; enable with `SECURITY_GUARD_ENABLED=true`. Fails open by default (CLI errors allow messages through). Unparseable LLM responses default to deny (blocked).

**API Authentication:** Optional token-based auth for all API endpoints and WebSocket connections. Set `API_SECRET` in `.env` to enable. The server prints the authenticated UI URL at startup. Pups receive the token automatically. When unset, access is open (backward compatible).

**Pup Delegation:** Pups can spawn independent sub-agents using the `bark` CLI tool (`bark delegate "task"` or `bark delegate "task" --branch`). This is "delegate and forget" — the sub-agent works autonomously, appears in chat and the admin UI, and does not report results back to the parent. Sub-agents automatically inherit the parent's context (conversation summary, working directory, modified files). By default (soft mode), the sub-agent works on the same branch. With `--branch`, the sub-agent creates its own branch (`bark/{name}`) and opens a PR when done. Delegation instructions are injected into the system prompt of top-level agents only. Sub-agents cannot delegate further (max depth: 1). Each parent can have at most 3 active sub-agents (`MAX_SUB_AGENTS`). The `parentId` field on the agent object tracks the relationship. When a parent is cleared/deleted, sub-agents continue independently. The status message shows sub-agents with a `↳ParentName` tag. Agent cards in the admin UI show parent and sub-agent names, and sub-agent cards are visually indented. The `bark` CLI helper lives in `tools/bark` and is added to PATH in every tmux session via `BARK_AGENT_ID` and `BARK_API` env vars.

## Configuration

```bash
# .env
DEFAULT_BACKEND=claude-code
ENABLED_BACKENDS=claude-code,cursor,codex,gemini

# Platform adapters
WA_ENABLED=true
WA_GROUP=bark-pack
WA_OWNER=your-whatsapp-id

TELEGRAM_TOKEN=your-bot-token
TG_OWNER=your-telegram-id

SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_OWNER=your-slack-id

# Voice transcription
WHISPER_MODEL=/opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin

# Agent fallback
FALLBACK_ENABLED=true
AGENT_TIMEOUT=600000
FALLBACK_MAX_RETRIES=3
FALLBACK_BACKEND_PRIORITY=claude-code,cursor,codex,gemini

# Security Guard (uses claude CLI — no API key needed)
SECURITY_GUARD_ENABLED=true
SECURITY_GUARD_FAIL_OPEN=true

# API Authentication (optional — open access if unset)
API_SECRET=your-secret-here

# Pup Delegation
MAX_DELEGATION_DEPTH=1
MAX_SUB_AGENTS=3
```

## Key constraints

- `CLAUDECODE` env var must be deleted from child process env (prevents nesting error)
- PATH must include `/opt/homebrew/bin` for tmux, CLI tools, whisper-cli, and ffmpeg
- tmux sessions are recreated on-the-fly if lost after server restart
- Messages max ~4096 chars — output is truncated at server level
- Backend is immutable per-pup — switching requires `/delete` + new spawn

## ⚠️ CRITICAL: Git commit rules

**NEVER commit without explicit user approval.** This is the #1 rule for all pups.

1. **Before committing:** Always ask the user for approval first.
2. **Before pushing:** Always ask the user for approval first.
3. **No auto-commits:** Do not commit unless the user specifically asked.
4. **No batch commits:** Each commit should be one logical change.
5. **No force push:** Never `git push --force` without explicit approval.

## Commit conventions

All commits must end with a pup credit line:
```
🐾 Paw-Printed-By: Chase <chase@bark-pack>
```

## Do not

- Edit `.wwebjs_auth/` — WhatsApp session auth, breaks login if modified
- Run `node server.js` inside another Claude Code session — nesting error
- Commit or push without explicit user approval — see git rules above
