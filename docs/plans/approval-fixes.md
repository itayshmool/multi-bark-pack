# Approval Flow — Fixes & Missing Features

> Findings from a swarm review of the Chat-Native Approval Flow feature.
> Each item includes the file, the problem, severity, and suggested fix.

---

## Bugs

### 1. `compileRules()` can crash the server

**Severity:** High
**File:** `src/server/approval.ts` — `compileRules()` (~line 75)

`compileRules()` is called after the `loadPolicy()` try/catch block. If a user puts an invalid regex in `bark-policy.json` (e.g. `"pattern": "["` or `"pattern": "(?:"`), `new RegExp()` throws and crashes the server.

**Fix:** Wrap `compileRules()` body in try/catch. On error, log a warning, skip the invalid rule, and continue with the rest. Consider validating each rule's `pattern` individually so one bad rule doesn't disable all enforcement.

---

### 2. No `flushCurrentTool()` on stdin end

**Severity:** High
**File:** `src/stream-display.ts` — `process.stdin.on('end', ...)` (~line 420)

If the backend stream ends while a tool is in progress (crash, kill, pipe closed), the last tool is never flushed for policy checking. The violation goes unrecorded.

**Fix:** Add `flushCurrentTool()` at the top of the `stdin` end handler:
```typescript
process.stdin.on('end', () => {
  flushCurrentTool(); // Check last tool before closing
  if (!fs.existsSync(doneMarker)) {
    fs.writeFileSync(outFile, fullText || '(no output)');
    fs.writeFileSync(doneMarker, '1');
  }
});
```

---

### 3. Voice "approve" not intercepted

**Severity:** Medium
**File:** `src/server/routing.ts` — approval intercept in `onMessage()`

The approval reply intercept runs before voice transcription (media handling). A voice message saying "approve" or "deny" has `msg.text` empty at intercept time, so it passes through as a normal message routed to the agent.

**Fix:** Move the approval intercept to AFTER the voice transcription step, or add a second check after transcription that re-evaluates approval replies.

---

### 4. Multi-adapter timeout uses wrong adapter

**Severity:** Medium
**File:** `src/server/approval.ts` — `startTimeoutChecker()` (~line 285)
**File:** `src/server/index.ts` — `initApproval({ getAdapter: () => getAdapters()[0] })`

The timeout checker always uses `getAdapters()[0]` (the first adapter). If an approval was sent via Telegram but the first adapter is WhatsApp, the timeout denial edit fails silently because each adapter can only edit its own message IDs.

**Fix:** Store the adapter name (or platform) in `ApprovalRequest`. On timeout, look up the correct adapter by name instead of using the first one. See "Missing: Adapter tracking" below.

---

### 5. `adapter.send()` returning null creates bad routing entry

**Severity:** Low
**File:** `src/server/approval.ts` — `requestApproval()` (~line 240)

If `adapter.send()` returns `null` or `undefined`, `approvalMsgId` becomes `''`. `setMsgAgent('', agent.id)` creates a routing entry with an empty key, which could match unexpected message lookups.

**Fix:** Guard the `setMsgAgent` call:
```typescript
if (approvalMsgId) setMsgAgent(approvalMsgId, agent.id);
```
(This guard already exists — verify it's correct in the current code.)

---

## Missing Features

### 6. Adapter tracking in ApprovalRequest

**Priority:** High
**File:** `src/types/approval.ts`, `src/server/approval.ts`

`ApprovalRequest` does not store which adapter (WhatsApp, Telegram, Slack) the approval was sent on. This causes:
- Timeout checker uses wrong adapter (bug #4)
- `/approve pack` uses the command sender's adapter for all agents, failing for cross-platform approvals
- No way to know which platform to send the denial/approval message on

**Fix:** Add `adapterName: string` to `ApprovalRequest`. Set it in `requestApproval()`. Use it in `resolveApproval()` and the timeout checker to look up the correct adapter.

---

### 7. Policy hot-reload

**Priority:** Medium

Policy is loaded once at server startup. Editing `bark-policy.json` requires a full `/restart`. For teams iterating on rules, this is friction.

**Fix:** Add a `/reload-policy` command (or watch `bark-policy.json` with `fs.watch`). Call `loadPolicy()` on change. Broadcast the new rule count to status.

---

### 8. Audit log for approvals

**Priority:** Medium

Approvals and denials are logged to console but not persisted. No way to review past approval decisions, who approved what, or which operations were blocked.

**Fix:** Append approval events to `.bark-tmp/approval.log` (or a JSONL file). Each entry: `{ timestamp, agentId, agentName, tool, args, action, decision, decidedBy, latencyMs }`.

---

### 9. Extend `parseApprovalReply` vocabulary

**Priority:** Low
**File:** `src/server/approval.ts` — `APPROVE_WORDS` / `DENY_WORDS` (~line 187)

Common phrases like "sure", "go ahead", "sounds good", "do it", "fine", "absolutely" are not recognized. Users have to use exact words.

**Fix:** Extend the regex:
```typescript
const APPROVE_WORDS = /^(approve|approved|yes|ok|y|proceed|go|do it|lgtm|sure|go ahead|sounds good|fine|absolutely|yep|yup)$/i;
const DENY_WORDS = /^(deny|denied|no|n|reject|rejected|stop|cancel|abort|nope|don't|nah|negative|block)$/i;
```

---

### 10. Schema validation for `bark-policy.json`

**Priority:** Low
**File:** `src/server/approval.ts` — `loadPolicy()`

No validation of the policy file structure. Missing `action` fields, non-string `tool`/`pattern`, or unknown keys are silently accepted. Invalid rules can cause runtime errors.

**Fix:** Validate each rule after parsing:
- `tool` must be a non-empty string
- `action` must be one of `auto_approve`, `require_approval`, `block`
- `pattern` (if present) must be a valid regex
- Skip invalid rules with a warning instead of crashing

---

### 11. Per-agent policy overrides

**Priority:** Low

All agents share the same global policy. No way to give one agent looser rules (e.g. a trusted agent that can push) while keeping others strict.

**Fix:** Allow `agent.policyOverrides` (optional array of rules) that are evaluated before global rules. Set via `/policy Chase auto_approve git push` or similar.

---

### 12. Extend TOOL_NAME_ALIASES

**Priority:** Low
**File:** `src/stream-display.ts` — `TOOL_NAME_ALIASES`

Missing aliases for some known tool names:
- `search_replace` → `Edit`
- `multi_edit` / `multiEdit` → `MultiEdit`
- `read` / `write` / `edit` (bare lowercase) → canonical forms

**Fix:** Add the missing entries to the map.

---

## Test Gaps

### 13. `requestApproval` — no tests

**Priority:** High
**File:** `src/server/approval.test.ts`

The function that sends the approval message to chat, sets `approvalPending`, calls `setMsgAgent`, `saveState`, `broadcastAgents`, and `updatePinnedStatus` has zero test coverage.

---

### 14. Timeout behavior — no tests

**Priority:** High

`startTimeoutChecker` and the 15-second interval logic (check `requestedAt` vs `approvalTimeout`, auto-deny) are untested. No tests verify that timed-out approvals are correctly denied.

---

### 15. Malformed policy JSON — no tests

**Priority:** Medium

`loadPolicy()` has a catch block that falls back to defaults on parse error. This path is untested. No tests for partial JSON, missing fields, or `rules` containing non-objects.

---

### 16. `/approve` and `/deny` commands — no tests

**Priority:** Medium

The command handlers in `commands.ts` for `/approve name`, `/deny name`, `/approve pack`, and reply-to-approval are untested.

---

### 17. Routing intercept — no tests

**Priority:** Medium

The approval reply intercept in `routing.ts` (reply to approval message → `parseApprovalReply` → `resolveApproval`) is untested. No tests verify that quote-replies to approval messages are correctly intercepted.

---

### 18. Multiple violations per turn — no tests

**Priority:** Low

When a turn produces multiple violations, the `onComplete` callback picks the worst one (`block` first, else first). This selection logic is untested.

---

## Summary

| Category | Count | Items |
|----------|-------|-------|
| **Bugs** | 5 | compileRules crash, stdin flush, voice approve, multi-adapter timeout, empty routing key |
| **Missing Features** | 7 | Adapter tracking, hot-reload, audit log, reply vocabulary, schema validation, per-agent policy, tool aliases |
| **Test Gaps** | 6 | requestApproval, timeout, malformed JSON, commands, routing, multi-violation |

### Recommended fix order

1. `compileRules()` try/catch (prevents server crash)
2. `flushCurrentTool()` on stdin end (prevents missed violations)
3. Adapter tracking in `ApprovalRequest` (fixes multi-adapter bugs)
4. Voice approval intercept (fixes voice UX)
5. `requestApproval` + timeout tests (biggest coverage gap)
6. Schema validation + reply vocabulary (quality of life)
7. Everything else (nice to have)
