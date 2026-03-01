# multi-bark-pack Product Spec

## Vision

**Turn any chat message into a persistent AI coding agent.**

Send a message in WhatsApp, Telegram, or Slack. Get a coding agent ("pup") that:
- Lives in a tmux session on your machine
- Remembers its full conversation history
- Can use multiple LLM backends (Claude, Cursor, Codex)
- Clones repos, writes code, runs tests, sends files back

No context windows to manage. No copy-pasting. Just chat and code.

---

## Value Proposition

| For | Pain Point | Solution |
|-----|------------|----------|
| Solo devs | Context switching between chat and IDE | Chat IS the interface |
| Remote workers | Need AI help on mobile/tablet | Works from any chat app |
| Power users | Different tasks need different models | Multi-backend support |
| Teams | Want shared AI agents | Group chat = shared pack |

**Why chat?**
- Already open all day
- Works on any device
- Natural async communication
- History is automatic

---

## User Personas

### 1. Solo Developer ("Alex")
- Works on personal projects
- Uses Telegram on phone and desktop
- Wants quick AI help without opening IDE
- **Needs:** Simple setup, reliable responses, mobile access

### 2. Power User ("Sam")
- Multiple projects, complex workflows
- Wants Claude for architecture, Haiku for quick tasks
- Monitors multiple pups working in parallel
- **Needs:** Multi-backend, model switching, status visibility

### 3. Team Lead ("Jordan")
- Small team sharing a pack
- Wants team members to spawn agents for tasks
- Needs visibility into who's doing what
- **Needs:** Multi-owner, clear attribution, cost tracking

---

## Implementation Phases

### Phase 0: Foundation (DONE)
Fork bark-pack with backend abstraction layer.

**Deliverables:**
- [x] `backends/` directory structure
- [x] `backends/claude-code.js` extracted
- [x] `stream-parsers/` directory structure
- [x] `stream-parsers/claude.js` extracted
- [x] Backend registry in `backends/index.js`
- [x] Agent model includes `backend` field
- [x] `/backends` command shows capabilities
- [x] Updated CLAUDE.md and README.md

**Status:** Complete

---

### Phase 1: Backend Parity
Ensure claude-code backend works identically to bark-pack.

**Deliverables:**
- [ ] All commands work (`/status`, `/stop`, `/clear`, `/reset`, `/reborn`, etc.)
- [ ] Live message editing works
- [ ] Session persistence works (resume conversations)
- [ ] Voice transcription works
- [ ] Model switching works (`#haiku`, `#sonnet`, `#opus`)
- [ ] File sending works (pup → user)
- [ ] End-to-end test on all 3 platforms

**Success criteria:** No regressions from bark-pack

**How to test:**
1. Start server, send message in Telegram → pup spawns, responds
2. Reply to pup → conversation continues
3. `/status`, `/stop`, `/clear`, `/reset`, `/reborn` all work
4. Send voice message → transcribed and handled
5. Use `#haiku` tag → model switches
6. Pup sends file → you receive it

**Automated tests:** `node test/run-all.js` — 44 tests covering:
- Backend module and initialization
- Stream parser
- Agent lifecycle commands
- Status building

**Status:** ✅ Complete (automated tests pass)

---

### Phase 2: Cursor Backend
Add Cursor CLI as second backend.

**Research completed:**
- [x] Cursor CLI stream-json format — different from Claude, has `type: "thinking"`, `type: "tool_call"`, `type: "assistant"`, `type: "result"`
- [x] Session management — `agent create-chat` generates UUID, `--resume <id>` continues
- [x] System prompts — NOT supported in headless mode (workaround: prepend to first message)
- [x] Working directory — cwd reported in init message

**Deliverables:**
- [x] `backends/cursor.js` implemented
- [x] `stream-parsers/cursor.js` implemented
- [x] Backend selection at spawn time
- [x] Documentation updated

**Success criteria:** Can spawn pups with Cursor, sessions persist, streaming works

**How to test:**
1. Install Cursor CLI (`curl https://cursor.com/install -fsS | bash`)
2. Add `cursor` to `ENABLED_BACKENDS` in `.env`
3. Start server → logs show "Backend Cursor v..."
4. Spawn pup with Cursor backend
5. Verify live streaming works
6. Send follow-up → conversation resumes

**Status:** ✅ Complete

---

### Phase 3: Backend Selection UX
Make it easy to choose and switch backends.

**Deliverables:**
- [x] `#cursor` tag in messages — like `#haiku` for models
- [x] `#claude-code` and `#codex` tags supported
- [x] Backend shown in status (e.g., `🟢 Chase [cursor]`)
- [x] `/backends` shows which are installed vs available
- [x] Default backend configurable in `.env`
- [x] Backend validation with error message if unavailable

**Success criteria:** Users can easily spawn and identify backend per pup

**How to test:**
1. Send `#cursor fix this bug` → pup spawns with Cursor backend
2. `/status` shows `🟢 Chase [cursor]`
3. `/backends` lists installed vs available
4. Change `DEFAULT_BACKEND` in `.env` → new pups use it

**Status:** ✅ Complete

---

### Phase 4: Capability Matrix
Surface backend differences clearly.

**Deliverables:**
- [x] `/backends` shows feature matrix (streaming, sessions, etc.)
- [x] Graceful degradation for missing capabilities (systemPrompt → prepend to message)
- [ ] Warnings when using unsupported features (optional enhancement)
- [ ] Per-backend model lists in help (optional enhancement)

**Success criteria:** Users understand what each backend can/can't do

**How to test:**
1. `/backends` shows matrix with checkmarks for each capability
2. Use a feature not supported by backend → graceful fallback
3. `/help` shows available models per backend

**Status:** ✅ Complete (core features)

---

### Phase 5a: Codex Backend
Add OpenAI Codex CLI as a backend.

**Research completed:**
- [x] CLI: `codex` (v0.104.0)
- [x] Non-interactive mode: `codex exec --json`
- [x] Auto-approve: `--dangerously-bypass-approvals-and-sandbox`
- [x] Session resume: `codex exec resume --last` or by thread_id
- [x] Models: gpt-5.3-codex, o3, etc.

**Deliverables:**
- [x] `backends/codex.js` implemented
- [x] `stream-parsers/codex.js` implemented
- [x] Registered in backend and parser registries

**JSON format:**
```json
{"type":"thread.started","thread_id":"..."}
{"type":"turn.started"}
{"type":"item.completed","item":{"type":"reasoning","text":"..."}}
{"type":"item.completed","item":{"type":"agent_message","text":"..."}}
{"type":"turn.completed","usage":{...}}
```

**Status:** ✅ Complete

---

### Phase 5b: Gemini Backend
Add Google Gemini CLI as a backend.

**Research completed:**
- [x] CLI: `gemini` (v0.24.4)
- [x] Non-interactive mode: `--output-format stream-json`
- [x] Auto-approve: `-y` / `--yolo`
- [x] Session resume: `--resume <index>` or `--resume latest`
- [x] Models: auto-gemini-2.5, etc.

**Deliverables:**
- [x] `backends/gemini.js` implemented
- [x] `stream-parsers/gemini.js` implemented
- [x] Registered in backend and parser registries

**JSON format:**
```json
{"type":"init","session_id":"...","model":"..."}
{"type":"message","role":"user","content":"..."}
{"type":"tool_use","tool_name":"...","tool_id":"...","parameters":{}}
{"type":"tool_result","tool_id":"...","status":"...","output":"..."}
{"type":"message","role":"assistant","content":"...","delta":true}
{"type":"result","status":"...","stats":{...}}
```

**Status:** ✅ Complete

---

### Phase 5c: Future Backends (Optional)
Additional backend candidates for later.

**Candidates:**
- [ ] Aider (open source, has CLI)
- [ ] Continue (has API)
- [ ] Other agent CLIs as they emerge

**Status:** Future

---

### Phase 6: Management UI
Web dashboard for pack visibility and control.

**MVP Features (implemented):**
- [x] Dashboard showing all pups with live status
- [x] Pup detail view — metadata, backend, model, cwd, session info
- [x] Backend status — installed, versions
- [x] Stop/clear/delete pups from UI
- [x] WebSocket for live pup status updates
- [x] UI served at `http://localhost:3000` (configurable via `UI_PORT`)

**Future enhancements:**
- [ ] Platform status — connected adapters, health
- [ ] Cost/usage metrics (when available)
- [ ] Reset pup memory from UI
- [ ] Edit configuration (.env values)
- [ ] Stream pup progress to browser
- [ ] Live log viewer
- [ ] Embedded terminal (xterm.js) to watch tmux sessions

**Technical Stack:**
- Express.js server (integrated into server.js)
- WebSocket via `ws` package for real-time
- Vanilla HTML/CSS/JS frontend (no framework)
- CRT scan-line terminal aesthetic

**Deliverables:**
- [x] `ui/index.html` — single-file dashboard with embedded CSS/JS
- [x] REST API endpoints (`/api/agents`, `/api/backends`, etc.)
- [x] WebSocket server (`/ws`) for live updates

**Success criteria:** Can monitor and manage pack without using chat

**How to test:** Start server, open `http://localhost:3000`, see all pups and backends, click pup to view details, use stop/clear/delete controls, verify live updates via WebSocket.

**Status:** ✅ Complete (MVP)

---

### Phase 7: Cost & Usage Tracking
Track token usage and costs (where available).

**Deliverables:**
- [ ] Parse usage data from Claude output
- [ ] Track per-pup, per-session, per-day costs
- [ ] `/cost` command to show breakdown
- [ ] Cost in status message (optional)
- [ ] Budget alerts (optional)

**Success criteria:** Users can see how much they're spending

**How to test:** Run pups, use `/cost` command, verify numbers match Claude's reported usage.

**Status:** Out of scope (last priority)

---

## Current Status

**Phase:** 6 (Management UI) — Complete
**Next:** Phase 7 (Cost & Usage Tracking) or additional UI enhancements

**Working:**
- Backend abstraction layer
- Claude Code backend (v2.1.9)
- Cursor backend (v2026.01.23)
- Codex backend (v0.104.0)
- Gemini backend (v0.24.4)
- All chat adapters (WA, TG, Slack)
- Core commands
- Backend selection via `#backend` tags
- `/backends` capability matrix
- Graceful degradation for missing capabilities
- Management UI at `http://localhost:3000`
- REST API for agent/backend data
- WebSocket for live status updates

**Tested:**
- 44 automated tests passing
- All 4 backends detected and working
- Stream parsers for all backends verified
- UI renders with terminal aesthetic

---

## Success Metrics

### Functional
- All bark-pack features work in multi-bark-pack
- Can spawn pups with multiple backends
- Sessions persist across restarts

### User Experience
- Backend selection is intuitive
- Status clearly shows backend per pup
- No confusion about capabilities

### Technical
- Adding a new backend requires only 2 files
- No backend-specific code in server.js
- Clean separation of concerns

---

## Non-Goals (for now)

- **Chat replacement UI** — chat apps remain the primary interface for talking to pups
- **Cloud hosting** — runs on your machine
- **User accounts / auth** — owner IDs in .env, UI is local-only
- **Billing integration** — just tracking, no payments
- **Mobile app** — use existing chat apps

---

## Open Questions

1. **Backend switching mid-conversation?**
   - Current answer: No, backend is locked per pup
   - Rationale: Session IDs are backend-specific

2. **Default backend per platform?**
   - e.g., Telegram defaults to Claude, Slack to Cursor
   - Current answer: Single global default
   - Could revisit if there's demand

3. **Backend aliases?**
   - e.g., `#claude` instead of `#claude-code`
   - Nice to have, not blocking

4. **Fallback backends?**
   - If Claude is overloaded, try Cursor?
   - Complex, probably not worth it

---

## Changelog

| Date | Change |
|------|--------|
| 2024-02-21 | Initial spec created |
| 2024-02-21 | Phase 0 complete — fork with backend abstraction |
| 2024-02-21 | Phase 1 complete — backend parity tests (44 passing) |
| 2024-02-21 | Phase 2 complete — Cursor backend implemented |
| 2024-02-21 | Phase 3 complete — backend selection UX (#backend tags) |
| 2024-02-21 | Phase 4 complete — capability matrix and graceful degradation |
| 2024-02-21 | Phase 5a complete — Codex backend (OpenAI) |
| 2024-02-21 | Phase 5b complete — Gemini backend (Google) |
| 2024-02-21 | Phase 6 complete — Management UI (Express + WebSocket dashboard) |
