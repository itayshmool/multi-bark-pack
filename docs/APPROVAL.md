# Approval Flow & Policy Engine

Chat-native approval system for multi-bark-pack. Pups ask before executing dangerous operations. Users approve or deny directly in chat.

## Quick Start

1. Copy the example policy file:
   ```bash
   cp bark-policy.default.json bark-policy.json
   ```

2. Edit `bark-policy.json` to match your needs (see [Configuration](#configuration) below).

3. Start (or hot-reload) the server. The policy loads automatically at startup, or use `/reload-policy` to apply changes without restarting.

4. Pups now respect the policy:
   - **Safe operations** (read, grep, ls, tests) execute normally
   - **Risky operations** (git push, rm -rf, npm publish) require your approval
   - **Blocked operations** (docker push, kubectl apply) are forbidden

## How It Works

The approval system uses three defense layers:

### Layer 1: System Prompt (Prevention)

Policy rules are injected into every pup's system prompt. The pup is instructed to ask before executing operations that require approval, and to never attempt blocked operations. When the pup complies, the approval is a natural two-turn conversation:

```
User:   push the changes to main
Chase:  I'd like to run `git push origin main`. Approve?
User:   yes
Chase:  [executes git push, reports result]
```

### Layer 2: Stream Detection (Monitoring)

If a pup ignores the system prompt and executes a restricted operation anyway, `stream-display` catches it in real-time by matching tool calls against policy rules. A `.violation` file is written with details of the offense.

### Layer 3: Post-Turn Gate (Enforcement)

After each turn completes, the server checks for violations. If found:
- For `require_approval`: the response is held, and an approval request is sent to chat
- For `block`: an alert is sent to chat notifying you of the violation

## Configuration

### Policy File: `bark-policy.json`

Place this file in the project root. If absent, the default policy is `block` (everything blocked, nothing auto-approved).

```json
{
  "defaultAction": "block",
  "approvalTimeout": 300000,
  "rules": [
    { "tool": "Read",       "action": "auto_approve" },
    { "tool": "Grep",       "action": "auto_approve" },
    { "tool": "Glob",       "action": "auto_approve" },
    { "tool": "ListDir",    "action": "auto_approve" },

    { "tool": "Edit",       "action": "require_approval" },
    { "tool": "Write",      "action": "require_approval" },

    { "tool": "Bash", "pattern": "docker push|kubectl apply|terraform destroy", "action": "block" },
    { "tool": "Bash", "pattern": "deploy|npm run deploy|yarn deploy", "action": "require_approval" },
    { "tool": "Bash", "pattern": "ls |cat |grep |git status|git log|git diff|yarn |npm test|npm run|vitest", "action": "auto_approve" },
    { "tool": "Bash", "pattern": "git push|git reset --hard", "action": "require_approval" },
    { "tool": "Bash", "pattern": "rm -rf|sudo", "action": "require_approval" }
  ],
  "barkignore": [
    ".env", ".env.*",
    "*.pem", "*.key",
    "credentials.json"
  ]
}
```

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `defaultAction` | `"auto_approve"` \| `"require_approval"` \| `"block"` | `"block"` | Action for tool calls that don't match any rule |
| `approvalTimeout` | number (ms) | `300000` (5 min) | How long to wait for user reply before auto-denying |
| `rules` | array | `[]` | Ordered list of policy rules (first match wins) |
| `barkignore` | array | `[]` | Glob patterns for protected files |

### Rule Format

Each rule has:

| Field | Required | Description |
|-------|----------|-------------|
| `tool` | Yes | Tool name to match (exact, case-insensitive). E.g. `"Bash"`, `"Read"`, `"Edit"` |
| `pattern` | No | Regex pattern to match against tool arguments. If omitted, matches all uses of that tool |
| `action` | Yes | `"auto_approve"`, `"require_approval"`, or `"block"` |

**Schema validation:** Rules are validated at load time. Invalid rules (missing `tool`, unknown `action`, bad regex in `pattern`, non-object entries) are skipped with a warning — they don't crash the server or disable other rules. The server logs how many rules were skipped.

### Actions

- **`auto_approve`** -- Tool executes silently. No notification. Use for safe, read-only operations.
- **`require_approval`** -- Pup must ask before executing. If it executes anyway, the server holds the response and asks you in chat.
- **`block`** -- Operation is forbidden. Pup is told never to attempt it. If violated, an alert is sent.

### Rule Evaluation

Rules are evaluated **top to bottom, first match wins**. If no rule matches, `defaultAction` applies.

This means rule order matters. Place more specific rules before general ones:

```json
{
  "rules": [
    { "tool": "Bash", "pattern": "git status|git log", "action": "auto_approve" },
    { "tool": "Bash", "pattern": "git push", "action": "require_approval" },
    { "tool": "Bash", "pattern": "git", "action": "auto_approve" }
  ]
}
```

In this example:
- `git status` and `git log` match rule 1 (auto_approve)
- `git push origin main` matches rule 2 (require_approval)
- `git commit -m "fix"` matches rule 3 (auto_approve)

**Important:** Place dangerous substrings before safe broad rules. For example, `deploy` must come before `npm run` / `yarn `, otherwise `npm run deploy` would match the broad auto-approve rule first.

### Presets

The example file ships with three presets you can use as `defaultAction`:

| Preset | defaultAction | Philosophy |
|--------|---------------|------------|
| **Strict** (recommended) | `"block"` | Allowlist model. Only explicitly permitted operations run. |
| **Balanced** | `"require_approval"` | Unknown operations require approval but aren't silently blocked. |
| **Permissive** | `"auto_approve"` | Everything allowed unless explicitly blocked. Legacy behavior. |

### Barkignore

The `barkignore` field lists glob patterns for files that pups must never read, write, or commit. These patterns are:

- Injected into the system prompt
- Checked during stream detection for file-related tool calls

Supported glob syntax:
- `*` matches any characters within a filename
- `**` matches any number of directories
- `?` matches a single character

Examples:
```json
{
  "barkignore": [
    ".env", ".env.*",
    "credentials.json", "secrets.json",
    "*.pem", "*.key", "*.p12", "*.pfx",
    ".ssh/*", ".aws/*", ".gcloud/*",
    "**/node_modules/**"
  ]
}
```

## Approving and Denying

### Reply to the Approval Message

When a pup needs approval, it sends a message like:

> :warning: [Chase] ran an operation that requires approval:
> `Bash: git push origin main`
>
> Reply *approve* or *deny*.

Reply to this message with any of:
- **Approve**: `approve`, `yes`, `ok`, `y`, `proceed`, `go`, `do it`, `lgtm`, `sure`, `go ahead`, `sounds good`, `fine`, `absolutely`, `yep`, `yup`
- **Deny**: `deny`, `no`, `n`, `reject`, `stop`, `cancel`, `abort`, `nope`, `don't`, `nah`, `negative`, `block`

### Slash Commands

You can also use commands without replying to the message:

```
/approve Chase        # Approve Chase's pending operation
/deny Chase           # Deny Chase's pending operation
/approve pack         # Approve all pending operations
/deny pack            # Deny all pending operations
```

These also work as reply-to-message (reply to any pup's message with `/approve` or `/deny`).

### Voice Messages

Voice messages are supported for approvals. If you reply to an approval request with a voice message saying "approve" or "deny", it will be transcribed and recognized. The approval intercept runs after voice transcription, so all the same words listed above work via voice.

### Timeout

If you don't respond within `approvalTimeout` (default: 5 minutes), the operation is **auto-denied**.

## Backend Compatibility

The approval system works with all four backends:

| Backend | Tool Detection | Arguments Available | System Prompt |
|---------|---------------|---------------------|---------------|
| Claude Code | `tool_use` events in stream | Yes (accumulated from `input_json_delta`) | Native `--system-prompt` |
| Cursor | `tool_use` blocks + `tool_call` events | Yes (from `input` field / `shellToolCall`) | Prepended to prompt |
| Codex | `command_execution` events | Yes (`item.command`) | Prepended to prompt |
| Gemini | `tool_use` events | Yes (`parameters` field) | Prepended to prompt |

All backends run with auto-approve flags, so tools execute immediately. The approval system works post-execution -- it detects violations after the fact and holds/alerts rather than preventing execution.

### Cross-Backend Tool Name Normalization

Different backends use different tool names (e.g. Claude Code uses `Bash`, Gemini uses `shell`). The stream detector automatically normalizes these to canonical names so policy rules work uniformly:

| Backend native name | Normalized to | Policy rule `tool` |
|---------------------|---------------|-------------------|
| `Bash` (Claude Code, Cursor) | `Bash` | `"Bash"` |
| `shell`, `run_command`, `execute_command` (Gemini) | `Bash` | `"Bash"` |
| `command_execution` (Codex) | `Bash` | `"Bash"` |
| `read_file`, `read` (Gemini, bare) | `Read` | `"Read"` |
| `write_file`, `write` (Gemini, bare) | `Write` | `"Write"` |
| `edit_file`, `edit`, `search_replace` (Gemini, bare) | `Edit` | `"Edit"` |
| `multi_edit`, `multiEdit` | `MultiEdit` | `"MultiEdit"` |
| `list_directory`, `list_dir` (Gemini) | `ListDir` | `"ListDir"` |

Write policy rules using the **canonical** (Claude Code) names. They apply to all backends.

## Adapter Compatibility

Works identically on all three platforms:

| Platform | How to Approve | How it Routes |
|----------|---------------|---------------|
| WhatsApp | Quote-reply to approval message | `getQuotedMessage()` -> `getMsgAgent()` |
| Telegram | Reply to approval message | `reply_to_message` -> `getMsgAgent()` |
| Slack | Thread reply to approval message | Thread `ts` -> `getMsgAgent()` |

## Status Display

Pups awaiting approval show a `⏳approval` tag in the pinned status message:

```
🐾 🔵1 🟢2
🔵 Chase [claude-code] ⏳approval run
🟢 Marshall [cursor] idle
🟢 Skye [codex] idle
```

## Scenarios

### Safe Operation (Auto-Approved)

```
User:   @Chase check the test results
Chase:  [runs vitest, responds with results]
```
No approval needed -- `vitest` matches an `auto_approve` Bash rule.

### Approval Request (Happy Path)

```
User:   @Chase push the changes
Chase:  I'd like to run `git push origin main`. Should I proceed?
User:   yes
Chase:  [pushes, reports result]
```
The pup respected the system prompt and asked first.

### Violation Detected

```
User:   @Chase push the changes
Chase:  [ignores system prompt, runs git push directly]
Server: ⚠️ [Chase] ran an operation that requires approval:
        `Bash: git push origin main`
        Reply *approve* to deliver the response, or *deny* to suppress it.
User:   approve
Server: [delivers Chase's response]
```
The pup didn't ask, but the server caught it and held the response.

### Blocked Operation

```
User:   @Chase deploy to production
Chase:  [attempts docker push]
Server: 🚫 [Chase] attempted a BLOCKED operation:
        `Bash: docker push myapp:latest`
        This violates policy. The operation already executed — review required.
```

### Timeout

```
Server: ⚠️ [Chase] ran an operation that requires approval:
        `Bash: git push origin main`
        Reply *approve* to deliver the response, or *deny* to suppress it.
[5 minutes pass with no reply]
Server: 🚫 [Chase] operation denied: `Bash`
```

## Audit Log

All approval decisions are logged to `.bark-tmp/approval.log` in JSONL format (one JSON object per line). Each entry contains:

| Field | Description |
|-------|-------------|
| `timestamp` | ISO 8601 timestamp |
| `agentId` | Agent ID |
| `agentName` | Agent display name |
| `tool` | Tool that triggered the approval |
| `args` | Tool arguments (truncated to 500 chars) |
| `action` | Policy action (`require_approval` or `block`) |
| `decision` | `approved`, `denied`, or `timeout` |
| `latencyMs` | Time between request and decision (ms) |

Example log entry:
```json
{"timestamp":"2026-03-01T14:30:00.000Z","agentId":"a1b2c3","agentName":"Chase","tool":"Bash","args":"git push origin main","action":"require_approval","decision":"approved","latencyMs":12340}
```

The log is append-only and best-effort — write failures are silently ignored. Use it for auditing, debugging, or building dashboards.

## Files

| File | Purpose |
|------|---------|
| `bark-policy.json` | Policy configuration (copy from `bark-policy.default.json`) |
| `bark-policy.default.json` | Reference policy with all common rules pre-configured |
| `src/server/approval.ts` | Policy engine: load, validate, compile, evaluate, request/resolve approvals |
| `src/types/approval.ts` | Type definitions: `ApprovalPolicy`, `ApprovalRequest`, `PolicyRule`, `ViolationRecord` |
| `src/stream-display.ts` | Stream detector: tool name normalization, violation recording |
| `src/server/commands.ts` | `/approve`, `/deny`, `/reload-policy` command handlers |
| `src/server/routing.ts` | Approval reply intercept (quote-reply to approval message) |
| `.bark-tmp/approval.log` | Audit log of all approval decisions (JSONL, gitignored) |
| `.bark-tmp/{id}.violation` | Per-agent violation file written by stream-display |

## Troubleshooting

### Pup ignores the system prompt and executes anyway

This is expected behavior -- LLMs don't always follow instructions perfectly. The stream detection layer catches this and sends you an approval request or alert. The system prompt is a "soft" prevention layer; the stream detection is the "hard" enforcement.

### Too many approval requests (approval fatigue)

Add more `auto_approve` rules for operations you trust. Common additions:
```json
{ "tool": "Bash", "pattern": "git add|git commit", "action": "auto_approve" },
{ "tool": "Edit", "action": "auto_approve" },
{ "tool": "Write", "action": "auto_approve" }
```

Or switch to the **balanced** preset (`"defaultAction": "require_approval"` -> `"auto_approve"`).

### Pup is completely blocked and can't do anything

Your rules are likely too restrictive. Make sure read-only tools and safe bash commands are explicitly `auto_approve`'d. The example config in `bark-policy.default.json` is a good starting point.

### Policy changes not taking effect

The policy can be hot-reloaded without restarting the server:
```
/reload-policy
```

Alternatively, restart the server:
```
/restart
```

### Approval timeout is too short/long

Change `approvalTimeout` in `bark-policy.json` (value in milliseconds):
```json
{ "approvalTimeout": 600000 }
```
This sets it to 10 minutes.
