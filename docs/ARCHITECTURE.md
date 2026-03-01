# Architecture

> 81 TypeScript files, ~11,000 LOC in `src/` | Node.js >= 18 | ES2022 + NodeNext modules

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Chat Platforms                         │
│   WhatsApp (whatsapp-web.js)  Telegram (Bot API)  Slack  │
└────────────────────────┬─────────────────────────────────┘
                         │ NormalizedMessage
                         ▼
┌──────────────────────────────────────────────────────────┐
│                   Server Core (src/server/)               │
│                                                           │
│  routing.ts ──→ commands.ts (/ commands)                  │
│      │                                                    │
│      ▼                                                    │
│  agents.ts ──→ execution.ts ──→ tmux session              │
│      │              │                                     │
│      │              ▼                                     │
│      │    stream-display.ts ──→ .progress / .out / .done  │
│      │              │                                     │
│      ▼              ▼                                     │
│  state.ts    websocket.ts ──→ Admin UI (WebSocket)        │
└──────────────────────────────────────────────────────────┘
         │              │              │
         ▼              ▼              ▼
┌──────────────┐ ┌─────────────┐ ┌───────────────┐
│   Backends   │ │   History   │ │   Fallback    │
│ Claude Code  │ │  Per-agent  │ │ Retry→Reset   │
│ Cursor       │ │  turns +    │ │ →Switch       │
│ Codex        │ │  summaries  │ │ backend       │
│ Gemini       │ └─────────────┘ └───────────────┘
└──────────────┘
```

## Module Map

```
src/
├── server/           16 files  Core server: routing, agents, execution, API, WebSocket, commands
├── adapters/          3 files  Chat platforms: WhatsApp, Telegram, Slack
├── backends/          6 files  LLM CLI backends: Claude Code, Cursor, Codex, Gemini + shared
├── stream-parsers/    5 files  JSON stream parsers per backend
├── types/            16 files  All TypeScript type definitions
├── history/           3 files  Per-agent conversation tracking + rolling summaries
├── fallback/          4 files  Automatic failure recovery (retry → reset → switch)
├── security/          3 files  Optional LLM-based message threat screening
├── usage/             3 files  Cost and token tracking per agent/backend
├── timeline/          2 files  Activity event log (JSONL + in-memory ring buffer)
├── skills/            2 files  Cross-backend skill injection (SKILL.md files)
├── config/            2 files  Path constants + tool icon registry
├── utils/             6 files  Shared utilities (error, tokens, text, tags, agent-files, atomic-write)
├── setup/             6 files  Interactive setup wizard (checks, backends, adapters, env)
├── test/              3 files  Test infrastructure
└── stream-display.ts  1 file   Standalone: parses backend output, writes .progress/.out/.done
```

## Message Flow

```
Chat message arrives
    │
    ▼
Adapter.normalize() → NormalizedMessage {body, sender, replyTo, media, adapter}
    │
    ▼
routing.ts: onMessage()
    ├─ [1] Owner filter: check WA_OWNER / TG_OWNER / SLACK_OWNER
    ├─ [2] Voice: ffmpeg → whisper.cpp → text transcription
    ├─ [3] Media: download image → prepend path to body
    ├─ [4] Security: optional LLM screening (claude -p --model haiku)
    ├─ [5] Tags: parseMessageTags() → extract #model/#backend, strip from body
    ├─ [6] Commands: if /slash → commands.ts handlers → return
    └─ [7] Route:
           ├─ @name mention → findAgentByName() → sendToAgent()
           ├─ Reply to agent message → getMsgAgent(replyId) → sendToAgent()
           └─ New message → spawnAgent() → new pup with name from naming.ts
```

## Agent Lifecycle

```
SPAWN                          RUN                              POLL
├─ genId() → 6-hex            ├─ prepareAgentRun()             ├─ Check .done every 2s
├─ nextPupName()              │  ├─ Write .sysprompt           ├─ Read .progress → live edit
├─ backend.generateSessionId  │  ├─ Write .prompt              ├─ Timeout check (600s default)
├─ createTmuxSession()        │  ├─ Write .sh (backend cmd)    │
├─ Save to agents map         │  ├─ Write .running marker      ▼
├─ Send "thinking..." msg     │  └─ backend.buildCommand()     COMPLETE / TIMEOUT / ERROR
├─ Map msg → agent            │                                ├─ Read .out (final output)
└─ Record user turn           └─ tmux send-keys "bash .sh"     ├─ Update agent.cwd from .cwd
                                                                ├─ Deliver files from {id}-send/
                                                                ├─ Record history turn + usage
                                                                ├─ Emit timeline event
                                                                ├─ Classify failure → fallback
                                                                └─ Broadcast to WebSocket
```

## Backend Abstraction

Each backend implements the `Backend` interface:

| Method | Purpose |
|--------|---------|
| `isInstalled()` | Check CLI available (`which claude`) |
| `getVersion()` | Get CLI version string |
| `buildCommand()` | Generate shell script for tmux execution |
| `generateSessionId()` | Create session ID (UUID or backend-specific) |
| `validateModel()` | Check model name is valid |
| `extractSessionId()` | Parse session ID from output |

**Capabilities per backend:**

| | Claude Code | Cursor | Codex | Gemini |
|---|---|---|---|---|
| Streaming | Yes | Yes | Yes | Yes |
| Session resume | Yes (--resume) | No | No | No |
| System prompt | Yes | Yes | Yes | Yes |
| Working dir | Yes | Yes | Yes | Yes |
| Models | haiku/sonnet/opus | auto/opus-4.6/sonnet-4.5/4.6/gpt-5.3 | default/o3/o4-mini | gemini-2.5-pro/flash |

**Shared utilities** (`backends/shared.ts`):
- `BACKEND_EXEC_OPTS` — common exec options
- `BACKEND_METADATA` — name/displayName/cli/models/defaultModel per backend
- `isCliInstalled(cli)` / `getCliVersion(cmd)` — replaces per-backend duplication

## Stream Pipeline

```
Backend CLI stdout (JSON lines)
    │
    ▼
stream-display.ts (standalone Node process)
    ├─ Detect parser: claude / cursor / codex / gemini
    ├─ Parse events: thinking, text, tool_use, tool_result, init
    ├─ Write .progress (every 800ms) — thinking preview + tool chain
    ├─ Write .out — final response text
    ├─ Write .done — exit code (0 = success)
    ├─ Write .session — extracted session ID
    └─ Write .usage — {input_tokens, output_tokens, cost_usd}
```

**ParsedEvent types:** `thinking` | `thinking_start` | `text` | `tool` | `result` | `init`

## Fallback Recovery

```
Failure detected (exit code != 0 or timeout)
    │
    ▼
detector.ts: classifyFailure(output, exitCode)
    │  Match against FAILURE_PATTERNS:
    │  contextWindow, rateLimit, timeout, serverError, crash, auth, unknown
    │
    ▼
fallback/index.ts: executeFallback()
    │
    ├─ Strategy 1: RETRY
    │  └─ Exponential backoff → same session → same backend
    │
    ├─ Strategy 2: RESET
    │  └─ New session + inject context from history → same backend
    │
    ├─ Strategy 3: SWITCH
    │  └─ New session + inject context → next backend in priority list
    │
    └─ Strategy 4: NOTIFY
       └─ "Reply to retry or use /reset" — unrecoverable

Context injection (injector.ts):
    ├─ Load history → buildContextPrompt()
    │  [Previous Context Summary] + [Recent 5 Turns] + [Working Dir] + [Files Modified]
    ├─ If too large → buildMinimalContext() (summary + last turn only)
    └─ Set agent.fallbackContext → prepended to next prompt
```

## Dependency Injection

Circular imports avoided via lazy `init*()` functions wired in `server/index.ts`:

```
server/index.ts startup order:
  1. initState({broadcastAgents})
  2. initWebSocket({timeline})
  3. initExecution({backends, historyManager, usageTracker, timeline, skillsManager})
  4. initAgents({backends, historyManager, fallbackManager, timeline, skillsManager})
  5. initDaily({backends})
  6. initRouting({securityGuard, timeline})
  7. initCommands({backends, skillsManager, usageTracker, destroyAllAdapters, getPackNames})
  8. setupAuth(app)
  9. setupApiRoutes(app, {backends, historyManager, usageTracker, timeline, skillsManager})
 10. setupWebSocketUpgrade(httpServer)
```

Then `main()`:
```
  ensureDirectories() → loadState() → loadPacks()
  → backends.initialize() → skills.initialize() → security.initialize()
  → usage.initialize() → timeline.initialize()
  → httpServer.listen(3333) → cleanup stale .running files
  → init adapters (WhatsApp, Telegram, Slack) → send startup msgs
  → updatePinnedStatus()
```

## State Persistence

| File | Content | Written by |
|------|---------|------------|
| `agents.json` | Active + deleted agents (id, name, backend, session, model, cwd, status) | `state.ts: saveState()` |
| `routing.json` | Message ID → Agent ID map (prefixed: `wa:`, `tg:`, `slack:`) | `state.ts: saveState()` |
| `status.json` | Pinned status message IDs per adapter | `state.ts: saveState()` |
| `packs.json` | Agent naming packs (names, adjectives, active pack) | `naming.ts: savePacks()` |
| `.bark-tmp/{id}.history.json` | Per-agent conversation turns + summary | `history/storage.ts` |
| `.bark-tmp/usage.json` | Aggregated cost/token data per agent | `usage/storage.ts` |
| `.bark-tmp/timeline.jsonl` | Append-only event log | `timeline/storage.ts` |
| `.bark-tmp/security.log` | Blocked message audit log | `security/logger.ts` |

**Per-agent temp files** (`.bark-tmp/{id}.*`):

| Suffix | Purpose | Written by | Read by |
|--------|---------|------------|---------|
| `.prompt` | User message text | execution.ts | Backend CLI |
| `.sysprompt` | System instructions | execution.ts | Backend CLI |
| `.sh` | Shell command script | execution.ts | tmux (bash) |
| `.running` | Lock file (exists = running) | execution.ts | server polling |
| `.progress` | Live output preview | stream-display.ts | server → adapter.edit() |
| `.out` | Final response text | stream-display.ts | server → adapter.send() |
| `.done` | Exit code (0/1) | stream-display.ts | server polling |
| `.cwd` | Agent working directory | Agent CLI | server reads post-run |
| `.session` | Session ID (Codex/Gemini) | stream-display.ts | server reads post-run |
| `.usage` | Token/cost JSON | stream-display.ts | server → usageTracker |
| `-send/` | File outbox directory | Agent CLI | server → adapter.sendFile() |

## Delegation

```
Parent agent in tmux:
  $ bark delegate "task" [--branch]
    │
    ▼
tools/bark CLI → POST /api/agents {message, parentId, branch}
    │
    ├─ Check: parent active + <3 sub-agents + depth <=1
    ├─ Inject parent context (history summary + cwd)
    ├─ Spawn child with parentId set
    ├─ If --branch: child creates bark/{name} branch → PR on completion
    └─ Fire-and-forget: parent doesn't wait

Rules:
  - Max 3 sub-agents per parent (MAX_SUB_AGENTS)
  - Max depth 1 (no sub-sub-agents)
  - Sub-agents can't delegate further
  - Parent clear/delete doesn't kill children
  - setupTmuxEnv() injects BARK_AGENT_ID, BARK_API, BARK_TOKEN, PATH
```

## Security Guard

```
Optional (SECURITY_GUARD_ENABLED=true):
  Message → claude -p --model haiku → JSON verdict
    │
    ├─ {allowed: true} → continue to routing
    └─ {allowed: false, category, reason} → block + log

Categories: personal_data | destructive | injection | fraud | malware
Fail-open: CLI errors → allow (configurable)
Unparseable: → block (conservative)
Bypass: commands, UI messages, owner filter
```

## WebSocket (Admin UI)

```
Client connects → /ws (with API_SECRET auth if configured)
    │
    ▼
Initial state:
  {type: 'agents', agents: getAllAgentsWithStatus()}
  {type: 'timeline_init', events: getRecent(50)}

Live broadcasts:
  {type: 'agents', ...}          ← state changes (spawn/delete/reset)
  {type: 'timeline_event', ...}  ← activity events
  {type: 'agent_message', ...}   ← chat messages (user/assistant)
  {type: 'agent_stream', ...}    ← progress updates
  {type: 'packs', ...}           ← naming pack changes
```

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/agents` | List all agents (active + deleted + isRunning) |
| GET | `/api/agents/:id` | Get single agent |
| POST | `/api/agents` | Spawn new agent (accepts `message`, `parentId`, `branch`) |
| DELETE | `/api/agents/:id` | Hard delete |
| POST | `/api/agents/:id/message` | Send message to agent |
| POST | `/api/agents/:id/stop` | Stop agent (Ctrl+C) |
| POST | `/api/agents/:id/clear` | Soft delete (shelve) |
| GET | `/api/agents/:id/messages` | Conversation history |
| GET | `/api/backends` | Backend list + capabilities |
| GET | `/api/usage` | Usage/cost summary |
| GET | `/api/timeline` | Event timeline (supports `?limit=N`) |
| GET | `/api/packs` | All naming packs |
| GET | `/api/packs/active` | Active naming pack |
| PUT | `/api/packs/active` | Switch active pack |
| POST | `/api/packs` | Create new pack |
| PUT | `/api/packs/:id` | Update pack |
| DELETE | `/api/packs/:id` | Delete pack |
| GET | `/api/files/:filename` | Serve temp files (images, etc.) |
| WS | `/ws` | Real-time updates |

## Naming System

```
32 base names (Paw Patrol: Chase, Marshall, Skye, ...)
  × 32 adjectives (Sneaky, Speedy, ...)
  = 1,024 unique name combinations

Priority: bare name first → adjective-Name when all bare taken
Packs: multiple naming themes (packs.json), switchable at runtime
```

## Key Design Patterns

1. **Adapter abstraction** — Normalize WhatsApp/Telegram/Slack into unified `Adapter` interface
2. **Backend registry** — Factory functions per CLI, implementing `Backend` interface
3. **Lazy dependency injection** — `init*()` functions avoid circular imports
4. **File-based IPC** — `.bark-tmp/{id}.*` files bridge server ↔ tmux processes
5. **Live message editing** — Single message edited through lifecycle: thinking → progress → final
6. **Rolling summaries** — History turns capped + summarized for context preservation
7. **Strategy pattern** — Fallback tries retry → reset → switch in sequence
8. **Ring buffer** — Timeline keeps last 500 events in memory, older in JSONL
9. **Shared utilities** — `errorMessage()`, `estimateTokens()`, `truncateMessage()`, `getAgentFiles()`, `parseMessageTags()` deduplicated into `src/utils/`
10. **Broadcast consolidation** — `broadcastToWS()` + `getAllAgentsWithStatus()` eliminate duplicate patterns
