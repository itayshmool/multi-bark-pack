# Messaging & Command Reference

Complete guide to how messages flow through multi-bark-pack — from platform
chat down to the agent and back — plus every command available in chat.

---

## Message Pipeline (End-to-End)

```
Platform (WhatsApp / Telegram / Slack)
         │
         │  adapter.initialize(onMessage)
         ▼
┌─────────────────────────────────────────────────────────┐
│  ADAPTERS  src/adapters/{whatsapp,telegram,slack}.ts    │
│                                                         │
│  WhatsApp  client.on('message') → onMessage(normalized) │
│  Telegram  pollLoop()           → onMessage(normalized) │
│  Slack     socketMode           → onMessage(normalized) │
└────────────────────────┬────────────────────────────────┘
                         │ NormalizedMessage
                         ▼
┌─────────────────────────────────────────────────────────┐
│  ROUTER  src/server/routing.ts  onMessage()             │
│                                                         │
│  1. Owner filter       (WA_OWNER / TG_OWNER / SLACK_OWNER)│
│  2. Media download     (image → file, voice → wav)      │
│  3. Voice transcription (whisper.cpp)                   │
│  4. Approval intercept (reply to pending approval msg)  │
│  5. Command intercept  body.startsWith('/') ?           │
│         └─► handleCommand() → return                    │
│  6. Tag parse          #backend #model stripped         │
│  7. Security guard     optional LLM screen              │
│  8. Route:                                              │
│     A. @Name msg     → sendToAgent(agent, ...)          │
│     B. reply to msg  → sendToAgent(agent, ...)          │
│     C. last active   → sendToAgent(agent, ...)  ◄ DEFAULT│
│        (top-level only — sub-agents excluded)            │
│     D. no agent      → spawnAgent(...)          ◄ NEW PUP│
└────────────────────────┬────────────────────────────────┘
                         │
            ┌────────────┴──────────────┐
            │ spawnAgent()              │ sendToAgent()
            │ agents.ts:74             │ agents.ts:166
            │ • new Agent object        │ • setLastAgentForSource
            │ • tmux session created    │ • model switch if tagged
            │ • "thinking..." bubble    │ • "thinking..." bubble
            │ • setLastAgentForSource   │
            └────────────┬─────────────┘
                         │ runAgentCommand()  agents.ts:214
                         │ • rate-throttled adapter.edit wrapper
                         │ • per-agent async lock
                         ▼
┌─────────────────────────────────────────────────────────┐
│  EXECUTION  src/server/execution.ts                     │
│  executeAgentCommand()                                  │
│                                                         │
│  • prepareAgentRun()    write .prompt .sysprompt .sh   │
│  • ensureTmuxSession()  recreate if lost                │
│  • tmux send-keys       bash {script}                  │
│  • poll loop (default 1200ms):                          │
│      onProgress → adapter.edit(liveMsgId, progress)    │
│      timeout=0  → no timeout (configurable via env)    │
│      onDone:                                            │
│        1. read .out file                               │
│        2. classifyFailure() → fallback?                │
│        3. violations?  → requestApproval()  (hold)     │
│        4. deliverResponse()                            │
└────────────────────────┬────────────────────────────────┘
                         │ deliverResponse()  execution.ts:349
                         ▼
┌─────────────────────────────────────────────────────────┐
│  DELIVERY  (adapter-aware)                              │
│                                                         │
│  Telegram  finalMessageBehavior='send'                  │
│    • edit progress msg  → done receipt                  │
│    • send each chunk as new messages (reply chain)      │
│                                                         │
│  WhatsApp / Slack  finalMessageBehavior='edit'          │
│    • edit first chunk into the "thinking..." bubble     │
│    • send additional chunks as follow-up messages       │
│                                                         │
│  splitMessage() handles long output automatically       │
└─────────────────────────────────────────────────────────┘
```

---

## Routing in Detail

### Default: Last Active Pup
Every message with no `@mention` and no quoted reply is automatically delivered
to the **last active pup** on that platform. No need to address anyone — just
type and it goes to the right place.

```
You: "fix the login page"
  → Chase (last active) gets the message
```

### Switch to a Specific Pup
```
@Chase fix the login page     ← routes to Chase regardless of last-active
@Marshall review PR #42       ← routes to Marshall
```

### Continue a Conversation
Reply to any message from a pup — the reply goes to **that pup** regardless
of which is last-active.

### Spawn a New Pup
- A fresh message when **no pups exist** → spawns a new pup
- `/create` (with optional context) → spawns a new named pup

### Approval Replies
Replying to an approval request message resolves the approval — no command needed.
Natural language works: "go ahead", "sure", "nah", "deny".

---

## Backend & Model Tags

Add tags anywhere in a message to control which backend/model is used.
Tags are stripped before the message is forwarded to the agent.

| Tag | Effect |
|-----|--------|
| `#claude-code` | Use Claude Code CLI backend |
| `#cursor` | Use Cursor CLI backend |
| `#codex` | Use OpenAI Codex CLI backend |
| `#gemini` | Use Google Gemini CLI backend |
| `#haiku` | Use Haiku model (fast, cheap) |
| `#sonnet` | Use Sonnet model (balanced) |
| `#opus` | Use Opus model (most capable) |

Example: `#cursor #opus refactor the auth module`

Model persists per pup after being set. Backend is locked at spawn.

---

## All Commands

Use `pack` in place of any name to target all active pups at once.

---

### Navigation & Status

| Command | What it does |
|---------|-------------|
| `/help` | All commands grouped, plus routing cheatsheet |
| `/help full` | Full command list with descriptions |
| `/status` | Force-refresh the pinned status message |
| `/stats` | **Agent list** — name, 🟢/⚪/🔴 status, backend, cost, turns + routing cheatsheet |
| `/stats @Name` | Detailed view for one pup — status, backend, model, cwd, cost, turns |
| `/backends` | Show available LLM backends with capability matrix |
| `/daily` | One-line standup from every active pup |

---

### Agent Lifecycle

| Command | What it does |
|---------|-------------|
| `/stop @Name` | Send Ctrl+C to stop a running pup (stays active, can continue) |
| `/stop pack` | Stop all running pups |
| `/stopall` | Shortcut for `/stop pack` |
| `/clear @Name` | Shelve a pup (soft-delete, history preserved, can `/reborn`) |
| `/clear pack` | Shelve all pups |
| `/delete @Name` | Permanently delete pup (frees name, no recovery) |
| `/delete pack` | Permanently delete all active pups |
| `/reset @Name` | Wipe pup memory — new session, clears cwd, keeps backend |
| `/reset pack` | Wipe all pup memory |
| `/losts` | List all shelved pups with age |
| `/reborn @Name` | Resurrect a shelved pup, restores session history |
| `/purge` | Permanently delete ALL shelved pups, free all names |
| `/create` | Reply to a message → spawn new pup with that as context |
| `/create @Name` | Reply to spawn a pup with a specific name |
| `/create @Name task` | Spawn pup with name and initial task |

---

### Spawning Hints (shown in the "thinking..." bubble)

When a new pup spawns you see:
```
🐕 Chase · claude-code
💭 thinking...
💡 Reply or `@Chase msg` to continue
📋 `/stats` agents · `/stop @Chase` · `/clear` · `/reset` · `/help` commands
```

---

### Content & Skills

| Command | What it does |
|---------|-------------|
| `/skills` | List all available skills |
| `/skill SkillName` | Show info for a specific skill |
| `/skill SkillName @Name` | Add skill to a pup (applies on next message) |

---

### Approval Flow

| Command | What it does |
|---------|-------------|
| `/approve @Name` | Approve a pup's pending operation |
| `/approve pack` | Approve all pending operations |
| `/deny @Name` | Deny a pup's pending operation |
| `/deny pack` | Deny all pending operations |

Shortcuts: reply directly to the approval message, or use natural phrases
("sure", "go ahead", "yes" / "nah", "no", "deny").

Approval timeout defaults to 5 minutes (auto-deny).

---

### Policy & Server

| Command | What it does |
|---------|-------------|
| `/reload-policy` | Hot-reload `bark-policy.json` without restarting |
| `/restart` | Restart the server (auto-restarts via `start.sh`) |
| `/shutdown` | Shut down cleanly — `start.sh` does NOT restart |

---

## Fallback & Recovery

When an agent fails, the system automatically:
1. **Retry** — exponential backoff, same session (transient errors)
2. **Reset** — new session + context injection (context window exceeded)
3. **Switch** — new backend + context injection (persistent failure)

Context is preserved across resets/switches via rolling conversation
summaries stored in `.bark-tmp/{id}.history.json`.

---

## Telegram-Specific Behavior

- **Command autocomplete**: All 21 commands registered via `setMyCommands` —
  tap `/` to see the full list in the Telegram client.
- **Delivery**: Telegram requires `send` not `edit` for final responses,
  so the progress message is converted to a receipt and new messages are sent.
- **Rate limiting**: Edit throttle is 3000ms (Telegram limit).
- **Chat ID**: Auto-detected from first message if not set in `.env`.

---

## WhatsApp / Slack-Specific Behavior

- **Delivery**: Edit throttle is 1500ms. Final response edits the "thinking..."
  bubble into the first chunk, additional chunks sent as follow-ups.
- **Slack**: Thread replies route back to the same pup automatically.
- **WhatsApp**: Voice messages transcribed locally via whisper.cpp.

---

## Agent Timeout

Default is **no timeout** (`AGENT_TIMEOUT=0`). Set in `.env` to enforce a
limit in milliseconds. Example: `AGENT_TIMEOUT=600000` = 10 minutes.

---

## File References

| File | Responsibility |
|------|---------------|
| `src/adapters/telegram.ts` | Telegram polling, `setMyCommands`, delivery |
| `src/adapters/whatsapp.ts` | WhatsApp client, delivery |
| `src/adapters/slack.ts` | Slack socket mode, delivery |
| `src/server/routing.ts` | `onMessage()` — full routing pipeline |
| `src/server/commands.ts` | `handleCommand()` — all `/command` handlers |
| `src/server/agents.ts` | `spawnAgent()`, `sendToAgent()`, `runAgentCommand()` |
| `src/server/execution.ts` | `executeAgentCommand()`, `deliverResponse()` |
| `src/server/approval.ts` | `requestApproval()`, `resolveApproval()`, policy engine |
| `src/fallback/index.ts` | Retry → Reset → Switch fallback manager |
| `src/history/summarizer.ts` | Context reminders for stale sessions |
