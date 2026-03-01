# Multi-Backend Architecture

This document describes the architecture for supporting multiple LLM agent backends in multi-bark-pack.

## Overview

The system abstracts the LLM agent execution layer to support multiple backends:
- Claude Code CLI (current)
- Cursor CLI (planned)
- OpenAI Codex (planned)
- Google Antigravity (planned)

Each backend implements a common interface, allowing pups to be spawned with any available backend.

## Directory Structure

```
multi-bark-pack/
├── server.js                 # Main orchestrator (backend-agnostic)
├── adapters/                 # Chat platform adapters (unchanged)
│   ├── whatsapp.js
│   ├── telegram.js
│   └── slack.js
├── backends/                 # LLM agent backends (NEW)
│   ├── index.js              # Registry + loader
│   ├── base.js               # Shared utilities
│   ├── claude-code.js        # Claude Code CLI backend
│   ├── cursor.js             # Cursor CLI backend
│   └── ...
├── stream-parsers/           # Output format handlers (NEW)
│   ├── index.js              # Parser registry
│   ├── claude.js             # Claude stream-json parser
│   ├── cursor.js             # Cursor stream-json parser
│   └── generic.js            # Fallback text parser
├── scripts/
├── package.json
└── ...
```

## Backend Interface

Each backend module exports a factory function that returns a backend instance:

```javascript
// backends/claude-code.js
module.exports = function createClaudeCodeBackend(config) {
  return {
    // --- Identity ---
    name: 'claude-code',
    displayName: 'Claude Code',

    // --- Availability ---
    async isInstalled() {
      // Returns true if the CLI is available
      // e.g., check if `claude` command exists
    },

    async getVersion() {
      // Returns version string or null
      // e.g., "1.0.34"
    },

    // --- Models ---
    models: ['opus', 'sonnet', 'haiku'],
    defaultModel: 'sonnet',

    validateModel(model) {
      // Returns true if model is valid for this backend
    },

    // --- Session Management ---
    canResume: true,  // Supports session persistence

    generateSessionId() {
      // Generate a new session ID
      // Claude: UUID
      // Cursor: null (assigned by CLI on first run)
    },

    // --- Command Building ---
    buildCommand(opts) {
      // Returns: { script: string, env: object }
      //
      // opts: {
      //   prompt: string,          // User's message
      //   promptFile: string,      // Path to prompt file
      //   sessionId: string|null,  // Session identifier
      //   isResume: boolean,       // First run vs follow-up
      //   model: string,           // Model to use
      //   systemPrompt: string,    // System prompt (first run only)
      //   systemPromptFile: string,// Path to system prompt file
      //   outputFile: string,      // Where to write final output
      //   progressFile: string,    // Where to write progress
      //   doneMarker: string,      // Touch this when done
      //   streamParser: string,    // Path to stream parser script
      // }
    },

    // --- Output Parsing ---
    streamParserName: 'claude',  // Which parser to use from stream-parsers/

    extractSessionId(output) {
      // Extract session ID from first-run output (if backend assigns it)
      // Claude: null (we provide the ID)
      // Cursor: parse chat ID from output
    },

    // --- Capabilities ---
    capabilities: {
      streaming: true,           // Live output streaming
      sessionPersistence: true,  // Resume conversations
      workingDirectory: true,    // cwd tracking support
      forceMode: true,           // Skip confirmations
      systemPrompt: true,        // Custom system prompts
      planning: true,            // Plan mode support
    },
  };
};
```

## Stream Parser Interface

Each stream parser processes CLI output and writes progress/output files:

```javascript
// stream-parsers/claude.js
module.exports = {
  name: 'claude',

  // Tool icons for progress display
  toolIcons: {
    Bash: '💻', Read: '📖', Edit: '✏️', Write: '📝',
    Grep: '🔍', Glob: '📂', WebFetch: '🌐', Task: '🔀',
  },

  // Parse a line of streaming output
  // Returns: { type: 'text'|'tool'|'thinking'|'result'|'error', data: any }
  parseLine(line) {
    try {
      const data = JSON.parse(line);
      // ... parse Claude's stream-json format
    } catch {
      return null;
    }
  },

  // Extract final result from parsed output
  extractResult(parsed) {
    // Returns: { text: string, isError: boolean }
  },
};
```

## Agent Model Changes

```javascript
// Agent object in agents.json
{
  id: "3-char hex",
  name: "Chase",
  backend: "claude-code",      // NEW: Backend identifier
  sessionId: "uuid-or-chat-id",
  model: "sonnet",             // Backend-specific model name
  tmuxSession: "bark-Chase",
  status: "active",
  cwd: "/path/to/project",
  hasRun: true,
  source: "telegram",
  createdAt: "2024-...",
}
```

## Backend Selection

### At Spawn Time

```
# Default backend (configured in .env)
/create review this code

# Explicit backend
/spawn cursor review this code
@Chase #cursor fix this bug
```

### Backend Lock-in

Once a pup is spawned with a backend, it cannot be changed:
- `backend` is immutable per-pup
- `/reset` keeps same backend (just new session)
- `/reborn` restores with original backend
- Switching requires `/delete` + new spawn

## Configuration

```bash
# .env
DEFAULT_BACKEND=claude-code
ENABLED_BACKENDS=claude-code,cursor

# Backend-specific
CURSOR_PATH=/usr/local/bin/agent
```

## Status Display

### Capability Matrix

```
backends
┌────────────┬─────────┬────────┬───────┐
│            │ claude  │ cursor │ codex │
├────────────┼─────────┼────────┼───────┤
│ streaming  │ ✓       │ ✓      │ ✗     │
│ sessions   │ ✓       │ ✓      │ ✓     │
│ cwd track  │ ✓       │ ?      │ ✗     │
│ models     │ 3       │ 6      │ 2     │
└────────────┴─────────┴────────┴───────┘
```

### Per-Pup Backend Display

```
🐾 bark-pack

⚙️ claude ✓ | cursor ✓ | codex ✗

🔵 Chase [claude]: working on auth...
🟢 Marshall [cursor]: idle
🔴 Skye [claude]: error
```

## Implementation Plan

### Phase 1: Extract Claude Code Backend ✅
1. Create `backends/` directory
2. Move command building logic to `backends/claude-code.js`
3. Move stream parsing to `stream-parsers/claude.js`
4. Update server.js to use backend interface
5. Add `backend` field to agents (default: 'claude-code')

### Phase 2: Backend Registry ✅
1. Create `backends/index.js` with registry
2. Implement backend discovery (check `isInstalled()`)
3. Add backend selection to spawn flow (`#backend` tags)
4. Update status display with backend info
5. Fix `/reset` to use `backend.generateSessionId()`
6. Fix `/daily` to use `backend.buildCommand()`

### Phase 3: Add Cursor Backend ✅
1. Implement `backends/cursor.js`
2. Implement `stream-parsers/cursor.js`
3. Test session management (uses `agent create-chat` + `--resume`)
4. Document feature gaps (no system prompt support)
5. Handle capability gaps (prepend system prompt to first message)

### Phase 4: Capability Matrix ✅
1. Add `/backends` command
2. Graceful degradation for missing capabilities

### Phase 5a: Codex Backend ✅
1. Implement `backends/codex.js`
2. Implement `stream-parsers/codex.js`
3. CLI: `codex exec --json`
4. Session resume via thread_id
5. Models: gpt-5.3-codex, o3, o4-mini

### Phase 5b: Gemini Backend ✅
1. Implement `backends/gemini.js`
2. Implement `stream-parsers/gemini.js`
3. CLI: `gemini -y --output-format stream-json`
4. Session resume via UUID
5. Models: auto-gemini-2.5, gemini-2.5-pro, gemini-2.5-flash

## Resolved Questions

1. **Cursor stream-json format**: Different from Claude's - has `type: "thinking"`, `type: "tool_call"`, `type: "assistant"`, `type: "result"` structure
2. **Cursor session IDs**: Generated via `agent create-chat`, returns UUID
3. **Working directory**: Cursor reports cwd in init message
4. **System prompts**: NOT supported in Cursor CLI - workaround: prepend to first user message

## Optional Enhancements (Future)

### Show capability matrix in /status message
- Add backend availability indicators to pinned status
- Show which backends are online/offline

### Add more backends
- ✅ OpenAI Codex CLI (Phase 5a)
- ✅ Google Gemini CLI (Phase 5b)
- Aider (open source)
- Continue (has API)
- Other agent CLIs as they become available

### Token/cost tracking per backend
- Track token usage per agent per session
- Aggregate costs by backend
- Display in `/status` or dedicated `/costs` command

### Backend health monitoring
- Periodic health checks for each backend
- Auto-disable unhealthy backends
- Alert on backend failures

### Automatic fallback on failure
- If primary backend fails, try secondary
- Configurable fallback order
- Preserve session if possible (may require re-prompting)
