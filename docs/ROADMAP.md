# multi-bark-pack Roadmap

## Done

- **WhatsApp bridge** — receive/send messages via whatsapp-web.js, QR auth, persistent session
- **Agent spawning** — each message spawns a backend CLI process in a named tmux session
- **Agent registry** — `agents.json` tracks active/deleted agents with session IDs
- **Message routing** — reply-to > @mention > new spawn, persisted across restarts
- **Multi-agent** — up to 1,024 unique pup names (32 names × 32 adjectives), switchable name packs
- **Soft-delete & reborn** — `/clear` preserves session; `/reborn` resumes with full history
- **Pinned status** — auto-refreshing status message with pup list + backend indicator
- **Voice messages** — local transcription via whisper.cpp, no cloud API
- **Telegram adapter** — full feature parity with WhatsApp (routing, status, commands, voice)
- **Slack adapter** — Socket Mode, @mentions, thread routing, DM fallback, pin management
- **Multi-owner filter** — comma-separated owner IDs per platform, `DANGER-ALL` wildcard
- **Model selection** — `#haiku` / `#sonnet` / `#opus` tags switch model per pup
- **Daily standup** — `/daily` collects a one-line status from every active pup
- **Graceful shutdown** — `/shutdown` exits without auto-restart; `/restart` auto-restarts
- **Multi-backend** — Claude Code, Cursor, Codex, Gemini with backend selection via `#backend` tags
- **Backend abstraction** — unified interface (isInstalled, buildCommand, generateSessionId, capabilities)
- **Stream parsers** — per-backend JSON stream parsing (claude, cursor, codex, gemini)
- **REST API** — full CRUD for agents, backends, usage, timeline, packs (`/api/*` routes)
- **Admin UI** — web dashboard with live agent status, chat panel, timeline, usage, name packs
- **WebSocket** — real-time broadcasts (agent state, timeline events, messages, progress)
- **Agent fallback** — automatic retry → reset → switch backend with context injection
- **Pup delegation** — `bark delegate "task" [--branch]` for spawning sub-agents
- **Cost & usage tracking** — per-agent, per-backend token/cost tracking, `/stats` command
- **Conversation history** — server-side turn tracking + rolling summaries for context preservation
- **Security guard** — optional LLM-based message threat screening (5 categories)
- **Cross-backend skills** — reusable prompt modules (SKILL.md files, `/skill` command)
- **Activity timeline** — JSONL storage + in-memory ring buffer for event logging
- **API authentication** — optional token-based auth for API + WebSocket
- **Setup wizard** — browser-based interactive setup (prerequisites, backends, adapters, .env)

## Planned

### Broadcast
Send a message to all active agents at once.

- `/broadcast message` or `@pack message` — fan out to all active pups
- Useful for: "the schema changed, re-read db/schema.sql", "standup time"

### Commander Claude
A persistent top-level agent that orchestrates others.

- Auto-spawns on server start, listens on DM
- Can spawn sub-agents and delegate tasks
- Sub-agents report to Commander; Commander reports to you

### Shared Tool Registry
Agents register scripts they build so others can reuse them.

- `tools-registry.json` — name, description, path, usage
- New agents get the registry injected into their system prompt
- Any agent can call `register-tool` or `list-tools`

### Linux / Cross-platform Support
Currently macOS/Homebrew only. Planned:

- Configurable binary paths (whisper-cli, ffmpeg)
- Docker image for one-command deploy
- systemd unit file for running as a service
