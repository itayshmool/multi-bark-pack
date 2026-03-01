# bark-pack Roadmap

## Done

- **WhatsApp bridge** — receive/send messages via whatsapp-web.js, QR auth, persistent session
- **Agent spawning** — each message spawns a `claude -p` process in a named tmux session
- **Agent registry** — `agents.json` tracks active/deleted agents with session IDs
- **Message routing** — reply-to > @mention > new spawn, persisted across restarts
- **Multi-agent** — up to 1,024 unique pup names (32 Paw Patrol × 32 adjectives)
- **Soft-delete & reborn** — `/delete` preserves session; `/reborn` resumes with full history
- **Pinned status** — auto-refreshing status message with pup list + git branch/files
- **Voice messages** — local transcription via whisper.cpp, no cloud API
- **Telegram adapter** — full feature parity with WhatsApp (routing, status, commands, voice)
- **Slack adapter** — Socket Mode, @mentions, thread routing, DM fallback, pin management
- **Multi-owner filter** — comma-separated owner IDs per platform, `DANGER-ALL` wildcard
- **Model selection** — `#haiku` / `#sonnet` / `#opus` tags switch Claude model per message
- **Daily standup** — `/daily` collects a one-line status from every active pup
- **Graceful shutdown** — `/shutdown` exits without auto-restart; `/restart` auto-restarts

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

### Agent Self-Spawning
Agents can create child agents and receive their output.

- Agents call a `spawn-child` tool to delegate sub-tasks
- Children report back to parent when done
- Parent summarises and replies to the original message

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

### REST API
Control the pack via HTTP without being in the chat.

- `POST /message` — send a message to an agent
- `GET /agents` — list active agents
- `POST /agents/:name/stop` — stop an agent
- Helper functions (`stopAgents()`, `deleteAgents()`, `clearAgents()`) are already extracted and ready to wire up
