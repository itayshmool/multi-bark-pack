# Performance Audit — Remaining Findings

> Findings from the swarm exploration that haven't been fixed yet.
> Each item includes the file, the problem, why it matters, and a suggested fix.

---

## High Severity

### 1. Sequential `getVersion()` in `/api/backends`

**File:** `src/server/api.ts` ~lines 120–137

Backend versions are fetched one-by-one with `await backend.getVersion()` inside a `for` loop. Each spawns `execSync(cli --version)`, taking 100–500ms. With 4 backends, total latency reaches ~2s.

**Fix:** Use `Promise.all()` to fetch all versions in parallel.

---

### 2. Sequential `execSync` per idle pup in daily standup

**File:** `src/server/daily.ts` ~lines 138–172

For each idle pup, two blocking `execSync` calls (`tmux has-session`, `tmux send-keys`) run before the async standup promises start. With 10 pups, that's 20 event-loop-blocking calls in sequence.

**Fix:** Move tmux checks into the async flow, or use the cached tmux session list from `status.ts`.

---

### 3. Polling with `setInterval` + `existsSync` every second per pup

**File:** `src/server/daily.ts` ~lines 175–192

Each idle pup gets a 1-second `setInterval` that calls `existsSync(doneFile)` + `readFileSync(outFile)`. With 10 pups, that's 20 syscalls/second.

**Fix:** Use a single shared poller that batch-checks all pending pups in one pass, or use `fs.watch()` on the done files.

---

### 4. `execFile` per message when security guard is enabled

**File:** `src/security/index.ts` ~lines 67–84

Each incoming message spawns `execFile('claude', [...])` to screen content. This adds 1–5s latency per message.

**Fix:** Batch screening for rapid messages, or use a queue with a single persistent worker process. At minimum, document the latency cost in the config section.

---

### 5. `appendFileSync` on every timeline emit

**File:** `src/timeline/storage.ts` ~line 35

`appendFileSync(TIMELINE_FILE, JSON.stringify(event) + '\n')` blocks the event loop on every timeline event (spawn, message, response, etc.).

**Fix:** Use `fs.promises.appendFile()`, or buffer writes and flush periodically.

---

### 6. Heavy trim + rotate every 100 appends

**File:** `src/timeline/index.ts` ~lines 79–85

Every `TRIM_INTERVAL` (100) appends triggers `storage.trim()` and `storage.rotate()`, which do a full read-modify-write of the JSONL file.

**Fix:** Debounce trim/rotate (e.g., max once per 30s), or run in a background task.

---

## Medium Severity

### 7. Sequential adapter notifications in API delegation

**File:** `src/server/api.ts` ~lines 416–424

When delegating, adapters are notified with `await adapter.send(...)` in a sequential loop.

**Fix:** `Promise.allSettled(adapters.map(a => a.send(...)))` for parallel sends.

---

### 8. `writeFileSync` per file in `/api/upload`

**File:** `src/server/api.ts` ~lines 286–318

Each uploaded file is written with `writeFileSync(filepath, buffer)` inside a loop.

**Fix:** Use `fs.promises.writeFile()` + `Promise.all()`.

---

### 9. `getAllAgentsWithStatus` calls `existsSync` per agent

**File:** `src/server/state.ts` ~lines 130–135

Every API poll of `/api/agents` checks `existsSync(path.join(TMP_DIR, ${a.id}.running))` per agent.

**Fix:** Do a single `readdirSync(TMP_DIR)` for `.running` files, build a `Set`, and check membership. Or cache with a short TTL.

---

### 10. Sequential adapter updates in `updatePinnedStatus`

**File:** `src/server/status.ts` ~lines 153–177

Each adapter is updated one after another: `await adapter.edit(...)` then `await adapter.pin(...)`.

**Fix:** `Promise.all(adapters.map(...))` for parallel updates.

---

### 11. Sequential `execSync` for tmux kill in `/shutdown` and `/restart`

**File:** `src/server/commands.ts` ~lines 458–496

`execSync('tmux kill-session ...')` runs sequentially per agent.

**Fix:** Use `exec` (async) with `Promise.all()`, or kill multiple sessions with a single shell command.

---

### 12. Redundant `toLowerCase()` on static patterns

**File:** `src/fallback/detector.ts` ~line 154

`outputLower.includes(pattern.toLowerCase())` — patterns are already lowercase constants, so `toLowerCase()` is wasted work on every call.

**Fix:** Just use `outputLower.includes(pattern)`.

---

### 13. Duplicate `processAttachments` call

**File:** `src/server/api.ts` ~lines 373 and 447

`processAttachments(attachments!)` is called twice in the create-agent flow, each time doing `existsSync`, `path.basename`, `path.extname` per attachment.

**Fix:** Call once and reuse the result.

---

### 14. Multiple regex passes in tag parsing

**File:** `src/utils/tags.ts` ~lines 14–25

`parseMessageTags` uses separate `match()` + `replace()` for model tags, then again for backend tags — multiple passes over the string.

**Fix:** Single regex: `/#(haiku|sonnet|opus|claude-code|cursor|codex|gemini)\b/gi` with branching on match.

---

## Low Severity

### 15. `new RegExp` per message in Slack adapter

**File:** `src/adapters/slack.ts` ~lines 176–181

`new RegExp(\`<@${botUserId}>\`, 'g')` is created for every incoming Slack message to strip the bot mention.

**Fix:** Cache the regex once after auth: `const BOT_MENTION_RE = new RegExp(...)`.

---

### 16. Sequential unpin in WhatsApp adapter

**File:** `src/adapters/whatsapp.ts` ~lines 91–106

`for (const msg of pinned) { await msg.unpin(); }` — each unpin awaited sequentially.

**Fix:** `Promise.all(pinned.map(m => m.unpin().catch(() => {})))`.

---

### 17. Debug `console.log` on every message

**File:** `src/server/routing.ts` ~lines 27–29, 97–99

`[DEBUG] Message received: ...` fires for every message with full string formatting.

**Fix:** Guard with `if (process.env.DEBUG)` or use a log-level system.

---

### 18. String concatenation in loop for attachments

**File:** `src/server/api.ts` ~lines 76–92

`promptPrefix = \`[Image attached]...\n\n${promptPrefix}\`` prepends in a loop, causing O(n²) string copies with many attachments.

**Fix:** Build an array and `join('\n\n')` at the end.

---

### 19. Repeated "reply-to" pattern in commands.ts

**File:** `src/server/commands.ts` ~lines 323–480

Same 15-line block for resolving an agent from a quoted reply appears 4 times (`/stop`, `/clear`, `/delete`, `/reset`).

**Fix:** Extract `resolveAgentFromReply(msg, adapter)` helper. Saves ~60 lines.

---

### 20. Repeated "pack vs names" resolution in agents.ts

**File:** `src/server/agents.ts` — `stopAgents`, `clearAgents`, `deleteAgents`, `resetAgents`

Same `if (names[0] === 'pack') { iterate all } else { find each by name }` pattern appears 4 times.

**Fix:** Extract `resolveAgentNames(names): Agent[]` helper. Saves ~40 lines.
