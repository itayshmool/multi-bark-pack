# multi-bark-pack

Multi-platform, multi-backend agent swarm. TypeScript + Node.js. Messages from WhatsApp/Telegram/Slack spawn LLM agents in tmux sessions.

**Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — full system design, data flows, module map, state persistence
**Instructions:** [CLAUDE.md](CLAUDE.md) — commands, configuration, constraints

## Project Snapshot

- **Language:** TypeScript (ES2022, NodeNext modules) | 80 files, ~10,900 LOC
- **Runtime:** Node.js >= 18
- **Source:** `src/` → compiles to `dist/`
- **Package manager:** yarn

## Setup & Run

```bash
yarn install              # Install dependencies
yarn build                # Compile TypeScript
yarn start                # Start server (auto-restart wrapper)
yarn dev                  # Dev mode with tsx --watch
yarn typecheck            # Type-check without emitting
yarn test                 # Run tests
yarn setup                # Interactive setup wizard
```

## Module Map

```
src/
├── server/           16 files  Core: routing, agents, execution, API, WebSocket, commands, state
├── adapters/          3 files  Chat platforms: WhatsApp, Telegram, Slack
├── backends/          6 files  LLM CLIs: Claude Code, Cursor, Codex, Gemini + shared utils
├── stream-parsers/    5 files  JSON stream output parsers per backend
├── types/            15 files  All TypeScript type definitions
├── history/           3 files  Per-agent conversation tracking + rolling summaries
├── fallback/          4 files  Auto recovery: retry → reset → switch backend
├── security/          3 files  Optional LLM-based message threat screening
├── usage/             3 files  Cost and token tracking per agent/backend
├── timeline/          2 files  Activity event log (JSONL + in-memory ring buffer)
├── skills/            2 files  Cross-backend skill injection (SKILL.md files)
├── config/            2 files  Path constants + tool icon registry
├── utils/             6 files  Shared: error, tokens, text, tags, agent-files, atomic-write
├── setup/             6 files  Interactive setup wizard (checks, backends, adapters, env)
├── test/              3 files  Test infrastructure
└── stream-display.ts  1 file   Standalone: backend output → .progress/.out/.done files
```

### Other Directories

| Path | Purpose |
|------|---------|
| `scripts/` | Shell: start.sh (auto-restart), prerequisites, install backends/whisper |
| `tools/bark` | CLI for pup delegation (`bark delegate "task" [--branch]`) |
| `ui/` | Admin dashboard (static HTML + WebSocket) |
| `docs/` | ARCHITECTURE, PRODUCT, ROADMAP, README, plans/ |
| `.claude/skills/` | Skill definitions (YAML frontmatter + markdown) |
| `.bark-tmp/` | Per-agent runtime temp files (gitignored) |
| `projects/` | Pup working directories (gitignored) |

## Core Flow

```
Message → Adapter.normalize() → routing.ts
  ├─ Owner filter → Voice transcription → Media download → Security screen
  ├─ /command → commands.ts
  └─ Route: @mention | reply-to | new spawn
       → agents.ts → execution.ts → tmux → backend CLI
       → stream-display.ts → .progress/.out/.done
       → poll → deliver response → history + usage + timeline
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed flow diagrams.

## Key Abstractions

### Adapter Interface (adapters/)
`send()` `edit()` `pin()` `sendFile()` `downloadMedia()` `getQuotedMessage()` `destroy()`

### Backend Interface (backends/)
`isInstalled()` `getVersion()` `buildCommand()` `generateSessionId()` `validateModel()` `capabilities`

### Fallback Strategies (fallback/)
`retry` (backoff) → `reset` (new session + context) → `switch` (new backend + context) → `notify`

## Key Files

| File | Purpose |
|------|---------|
| `src/server/index.ts` | Entry point: wire deps, boot adapters, start HTTP |
| `src/server/routing.ts` | Message routing: reply-to > @mention > spawn |
| `src/server/execution.ts` | Build command, tmux exec, poll, deliver response |
| `src/server/commands.ts` | All /slash command handlers |
| `src/server/agents.ts` | Agent lifecycle: spawn, send, stop, clear, reset, reborn |
| `src/server/state.ts` | In-memory state + persistence (agents.json, routing.json) |
| `src/server/api.ts` | REST API routes (/api/agents, /api/stats, etc.) |
| `src/server/websocket.ts` | Real-time broadcasts to admin UI |
| `src/backends/shared.ts` | Shared backend metadata, CLI helpers |
| `src/stream-display.ts` | Standalone: parse backend JSON → temp files |
| `src/types/index.ts` | Re-exports all type modules |
| `src/config/paths.ts` | All file/directory path constants |

## Conventions

- **Imports:** `.js` extensions (NodeNext module resolution)
- **Types:** All in `src/types/` — import from there, don't define inline
- **Error handling:** Use `errorMessage(e)` from `src/utils/error.ts`
- **File paths:** Use `getAgentFiles(id)` from `src/utils/agent-files.ts` for temp files
- **Tag parsing:** Use `parseMessageTags(body)` from `src/utils/tags.ts`
- **Text truncation:** Use `truncateMessage(text, max)` from `src/utils/text.ts`
- **Storage:** Use `atomicWrite()` from `src/utils/atomic-write.ts` for JSON writes
- **Backends:** Shared metadata in `BACKEND_METADATA` from `src/backends/shared.ts`

## Security & Secrets

- Never commit `.env`, `.wwebjs_auth/`, `agents.json`, `routing.json`
- `API_SECRET` in `.env` gates all API/WebSocket access
- `CLAUDECODE` env var must be deleted from child process env

## Definition of Done

```bash
yarn typecheck && yarn test
```
