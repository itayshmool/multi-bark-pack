# Feature Research: multi-bark-pack

## Summary

Research across 25+ agent swarm, coding agent, and multi-agent orchestration projects. Identified features multi-bark-pack is missing, validated against community demand (GitHub issue reactions), and prioritized by effort vs impact.

---

## Competitor Landscape

### Most Similar Projects

| Project | Stars | Description | Key Differentiators |
|---------|-------|-------------|---------------------|
| [ComposioHQ/agent-orchestrator](https://github.com/ComposioHQ/agent-orchestrator) | 2.8k | Parallel AI coding agents in tmux/Docker | Git worktree isolation, CI auto-fix, plugin system (8 slots), tracker integration (Linear/GitHub) |
| [sleepless-agent](https://github.com/context-machine-lab/sleepless-agent) | 805 | 24/7 Slack agent daemon with Claude Code | Task queue (SQLite), auto-PR, usage-based scheduling, planner/worker/evaluator pattern |
| [pi-mono](https://github.com/badlogic/pi-mono) | 18.4k | Monorepo: Slack bot + coding agent + unified LLM API | Unified multi-provider LLM API, TUI, vLLM pod management |
| [ruflo](https://github.com/ruvnet/ruflo) | 17k | Enterprise Claude Code orchestration | 60+ specialized agents, SONA self-learning, Byzantine consensus, HNSW vector memory, dual Claude+Codex mode |
| [eliza](https://github.com/elizaOS/eliza) | 17.6k | Multi-platform AI agent framework | Discord/Farcaster connectors, no-code builder, RAG/document ingestion, plugin system, desktop app |

### Broader Ecosystem

| Project | Stars | Category |
|---------|-------|----------|
| [Dify](https://github.com/langgenius/dify) | 130k | Workflow/pipeline platform |
| [RAGFlow](https://github.com/infiniflow/ragflow) | 74k | RAG engine + agents |
| [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) | 55k | Desktop/Docker AI app with RAG + MCP |
| [mem0](https://github.com/mem0ai/mem0) | 48k | Long-term memory for agents |
| [Khoj](https://github.com/khoj-ai/khoj) | 33k | Self-hosted AI with scheduling |
| [Goose](https://github.com/block/goose) | 32k | Extensible AI coding agent (Rust, MCP) |
| [claude-mem](https://github.com/thedotmack/claude-mem) | 32k | Session capture + compression for Claude Code |
| [LangGraph](https://github.com/langchain-ai/langgraph) | 25k | Graph-based agent orchestration |
| [OpenAI Swarm](https://github.com/openai/swarm) | 21k | Educational multi-agent orchestration |
| [Activepieces](https://github.com/activepieces/activepieces) | 21k | No-code automation with MCP |
| [AstrBot](https://github.com/AstrBotDevs/AstrBot) | 18k | IM chatbot with plugins + MCP |
| [Plandex](https://github.com/plandex-ai/plandex) | 15k | AI coding agent for large projects |
| [Trigger.dev](https://github.com/triggerdotdev/trigger.dev) | 14k | Serverless AI agents + scheduler |

---

## Community-Requested Features (GitHub Issues)

### Top Upvoted Across All Repos

| Reactions | Issue | Repo | Relevance |
|-----------|-------|------|-----------|
| **3,957** | [Support AGENTS.md](https://github.com/anthropics/claude-code/issues/6235) | claude-code | Already supported |
| **1,376** | [Reduce sycophantic phrasing](https://github.com/anthropics/claude-code/issues/3382) | claude-code | Low — LLM behavior |
| **591** | [Event hooks for agent actions](https://github.com/openai/codex/issues/2109) | codex | **High** — pre/post hooks |
| **554** | [Agent Client Protocol (ACP)](https://github.com/anthropics/claude-code/issues/6686) | claude-code | Medium — editor integration |
| **502** | [Plan mode](https://github.com/openai/codex/issues/2101) | codex | **High** — research before execute |
| **464** | [Zed integration with review/approve](https://github.com/openai/codex/pull/1707) | codex | Medium — approval flow |
| **407** | [Subagent support](https://github.com/openai/codex/issues/2604) | codex | Already have `bark delegate` |
| **405** | [Custom prompts with arguments](https://github.com/openai/codex/issues/2890) | codex | Medium — parameterized commands |
| **365** | [MCP tools for subagent only](https://github.com/anthropics/claude-code/issues/6915) | claude-code | Medium — tool scoping |
| **247** | [Remote development (SSH)](https://github.com/openai/codex/issues/10450) | codex | Medium — hosted setups |
| **220** | [Exclude sensitive files (.codexignore)](https://github.com/openai/codex/issues/2847) | codex | **High** — security |
| **28** | [A2A protocol support](https://github.com/langgenius/dify/issues/19352) | dify | **High** — agent interop |
| **22** | [Agent Skills as tool provider](https://github.com/langgenius/dify/issues/30052) | dify | Already have skills |
| **8** | [Universal orchestration for any CLI tool](https://github.com/ruvnet/ruflo/issues/310) | ruflo | Already doing this |

### By Theme

#### Agent Communication
- **Subagent support** (codex #2604, 407 reactions) — specialized agents per role
- **A2A protocol** (dify #19352, 28 reactions) — agent-to-agent interoperability
- **MCP tools scoped to subagents** (claude-code #6915, 365 reactions) — tool isolation
- **Per-agent memory isolation** (mem0 #3998, 6 reactions) — per-pup memory

#### Workflow & Scheduling
- **Event hooks** (codex #2109, 591 reactions) — pre/post action hooks
- **Plan mode** (codex #2101, 502 reactions) — research → plan → execute
- **Custom prompts with arguments** (codex #2890, 405 reactions) — parameterized commands
- **Parallel execution in flows** (activepieces #1204, 6 reactions)

#### Approval & Safety
- **Review/approve agent edits** (codex PR#1707, 464 reactions) — human gate on changes
- **Sensitive file exclusion** (codex #2847, 220 reactions) — `.barkignore`
- **Human-in-the-loop workflows** (dify #21455, 13 reactions) — pause and wait

#### Memory & Context
- **AGENTS.md support** (claude-code #6235, 3,957 reactions) — already supported
- **Per-node/per-agent memory** (dify #13738, 12 reactions) — shared vs independent
- **Non-OpenAI model support for memory** (mem0 #2689, 6 reactions)

#### Observability
- **Session history search** (goose #1505, 10 reactions) — Ctrl+F in history
- **Rate limit handling with fallback** (goose #887, 24 reactions) — already have fallback

---

## Feature Ideas — Prioritized

### Tier 1: Quick Wins (Small effort, high value)

#### 1. Chat-Native Approval Flow
**Source:** sagents, agent-gate, codex PR#1707 (464 reactions)
**Description:** Pup pauses before dangerous operations (`git push`, `rm -rf`, deploy). Sends approval request in chat. User replies "approve" or "deny".
**Implementation:** Intercept specific tool calls in stream output, pause execution, send chat message, wait for reply, resume or abort.
**Effort:** Small — extend adapters with approval message type + pause/resume in execution.

#### 2. Policy-Based Auto-Approve/Deny
**Source:** agent-gate, codex #2847 (220 reactions)
**Description:** Rules like "auto-approve file reads", "require approval for git push to main", "block rm -rf". Reduces approval fatigue. Includes `.barkignore` for sensitive file exclusion.
**Implementation:** Policy config in `.env` or `bark-policy.json`. Evaluated before tool execution.
**Effort:** Small — policy engine + rule evaluation.

#### 3. Structured Event Stream
**Source:** multiagent-trace-middleware
**Description:** Emit JSON events (`tool_call`, `thinking`, `error`, `file_edit`) per pup. Admin UI shows live trace via WebSocket. Extends existing timeline module.
**Implementation:** Parse backend stream output for tool events, emit to timeline + WebSocket.
**Effort:** Small — event schema + WebSocket broadcast.

#### 4. Cost Attribution Per Task
**Source:** AgentStack
**Description:** Attach token/cost to each delegation task, not just per-pup aggregate. "Chase's PR review cost $0.12".
**Implementation:** Track usage per-task in delegation module.
**Effort:** Small — extend usage module with task-level tracking.

### Tier 2: Medium Effort, High Impact

#### 5. PR Review Pups (`/review`)
**Source:** ChatGPT-CodeReview (4.4k stars), claude-code system prompts
**Description:** `/review PR#123` or `/review @Chase PR#123` spawns a pup that reviews a GitHub PR and posts inline comments. Works with any backend.
**Implementation:** New command handler, GitHub API integration (gh CLI), review-specific system prompt.
**Effort:** Medium — new command + GitHub integration.
**Community demand:** Very high (code review is consistently requested across projects).

#### 6. Scheduled/Cron Pup Tasks
**Source:** Khoj (33k stars), Trigger.dev (14k stars), codex #2109 (591 reactions)
**Description:** `/schedule Chase "0 9 * * 1-5" "run tests and report"` — pups run on a schedule. Great for standups, nightly builds, health checks, recurring reviews.
**Implementation:** Cron parser + scheduler module, persisted in `schedules.json`. Event hooks for pre/post actions.
**Effort:** Medium — scheduler + persistence + command handler.

#### 7. Peer-to-Peer Pup Messaging
**Source:** chatarena (1.5k stars), Agent-Interaction-Protocol, codex #2604 (407 reactions)
**Description:** Sibling pups can message each other. `bark ask Marshall "run the tests and tell me the results"`. Goes beyond parent→child delegation to true collaboration.
**Implementation:** `bark ask <name> <message>` command + inter-agent message bus + response routing.
**Effort:** Medium — message bus, routing, and `bark ask` CLI command.

#### 8. Task Handoff Between Pups
**Source:** sagents, OpenAI Swarm
**Description:** Chase hands off to Marshall with full context. User: `@Chase hand off to Marshall`. Chase stops, Marshall receives summary + cwd + modified files.
**Implementation:** Extends delegation with handoff semantics (stop source, start target with context).
**Effort:** Medium — extends delegation module.

#### 9. Git Worktree Isolation
**Source:** ComposioHQ/agent-orchestrator (2.8k stars)
**Description:** Each pup works in its own git worktree instead of sharing a branch. No merge conflicts between parallel pups. Auto-cleanup on `/clear`.
**Implementation:** `git worktree add` per pup, worktree path as cwd.
**Effort:** Medium — git worktree management + cwd integration.

#### 10. Plan Mode
**Source:** codex #2101 (502 reactions), Plandex (15k stars)
**Description:** Pup researches and creates a plan before executing. User reviews/edits the plan, then approves execution. `/plan @Chase refactor the auth module`.
**Implementation:** Two-phase execution: plan (read-only) → review → execute.
**Effort:** Medium — new execution mode + review flow.

#### 11. MCP Memory Server
**Source:** mcp-mem0 (652 stars), mem0 (48k stars)
**Description:** Pups read/write persistent memories via MCP. Chase stores "user prefers strict TypeScript" and Marshall can recall it. Per-pup + shared memory spaces.
**Implementation:** MCP server wrapping mem0 or simple SQLite-backed memory store.
**Effort:** Medium — MCP server + integration with pup system prompts.

### Tier 3: Large Effort, Transformative

#### 12. Persistent Semantic Memory
**Source:** mem0 (48k stars), claude-mem (32k stars), EverMemOS (2.3k stars)
**Description:** Long-term memory layer per pup: facts, preferences, learned patterns, project knowledge. Injected into new sessions. Far better than rolling summaries.
**Implementation:** Embeddings + vector store (ChromaDB/SQLite-vec) + retrieval on each message.
**Effort:** Large — embeddings pipeline, storage, retrieval, injection into prompts.

#### 13. Workflow Pipelines
**Source:** Dify (130k stars), Activepieces (21k stars)
**Description:** `/workflow build→test→deploy` — multi-step DAG pipelines. Pup completes step 1, automatically triggers step 2. Supports parallel branches and conditionals.
**Implementation:** Workflow definition format (JSON/YAML), execution engine, step state tracking.
**Effort:** Large — workflow engine + UI for definition + state management.

#### 14. Commander Agent (Orchestrator Pup)
**Source:** ruflo (17k stars), sleepless-agent (805 stars). Already on roadmap.
**Description:** Persistent orchestrator pup that auto-spawns on server start, accepts high-level tasks, decomposes them, delegates to worker pups, and reports results to user.
**Implementation:** Special agent with planner prompt, auto-delegation, result aggregation.
**Effort:** Large — planner logic + multi-delegation + result collection.

#### 15. Shared Message Pool / Arena
**Source:** chatarena (1.5k stars)
**Description:** Group task mode: multiple pups see each other's messages and coordinate. User starts: "All pups: coordinate on this migration."
**Implementation:** Shared message channel + broadcast to active pups + coordination protocol.
**Effort:** Large — new routing model + coordination logic.

### Tier 4: Future / Ecosystem

#### 16. Plugin / Extension System
**Source:** AstrBot (18k stars), Cheshire Cat (3k stars), eliza (17.6k stars)
**Description:** Plugins add tools and behaviors (GitHub, Jira, CI/CD, Slack reactions). Community-extendable. Plugins are directories with `manifest.json` + handlers.
**Effort:** Large

#### 17. MCP Gateway
**Source:** IBM mcp-context-forge (3.3k stars)
**Description:** Central gateway for pups to discover and use external MCP tools. Auth, guardrails, registry.
**Effort:** Large

#### 18. Event-Driven Triggers
**Source:** Beehive (6.5k stars), Trigger.dev (14k stars)
**Description:** Auto-spawn pups on events: PR opened, CI failed, cron schedule, webhook received.
**Effort:** Medium-Large

#### 19. Local LLM Backend (Ollama/LM Studio)
**Source:** goose #4197 (16 reactions), activepieces #3307 (19 reactions), mem0 #2689 (6 reactions)
**Description:** Add Ollama or LM Studio as a backend for local/private model usage.
**Effort:** Medium — new backend module (follows existing add-backend pattern)

---

## Recommended Roadmap

### Phase Next: Quick Wins (1-2 weeks)
1. Chat-native approval flow
2. Policy-based auto-approve + `.barkignore`
3. Structured event stream (extend timeline)
4. Cost attribution per task

### Phase Next+1: High-Impact Features (2-4 weeks)
5. `/review` command (PR review pups)
6. Scheduled/cron pup tasks
7. Peer-to-peer pup messaging (`bark ask`)
8. Git worktree isolation

### Phase Next+2: Transformative (4-8 weeks)
9. Plan mode
10. Persistent semantic memory (mem0 integration)
11. Commander agent (orchestrator)
12. Workflow pipelines

---

## References

- [ComposioHQ/agent-orchestrator](https://github.com/ComposioHQ/agent-orchestrator) — git worktree isolation, plugin system
- [sleepless-agent](https://github.com/context-machine-lab/sleepless-agent) — task queue, auto-PR
- [ruflo](https://github.com/ruvnet/ruflo) — self-learning, consensus, universal orchestration
- [eliza](https://github.com/elizaOS/eliza) — multi-platform, plugin system, no-code builder
- [mem0](https://github.com/mem0ai/mem0) — long-term agent memory
- [claude-mem](https://github.com/thedotmack/claude-mem) — session compression
- [Dify](https://github.com/langgenius/dify) — workflow DAGs, A2A protocol
- [Khoj](https://github.com/khoj-ai/khoj) — scheduled automations
- [Trigger.dev](https://github.com/triggerdotdev/trigger.dev) — AI workflow scheduler
- [chatarena](https://github.com/Farama-Foundation/chatarena) — shared message arena
- [agent-gate](https://github.com/dabit3/agent-gate) — approval gateway
- [sagents](https://github.com/sagents-ai/sagents) — tool-level approval middleware
- [ChatGPT-CodeReview](https://github.com/anc95/ChatGPT-CodeReview) — PR review bot
- [mcp-mem0](https://github.com/coleam00/mcp-mem0) — MCP memory server
- [IBM mcp-context-forge](https://github.com/IBM/mcp-context-forge) — MCP gateway
- [OpenAI Codex Issues](https://github.com/openai/codex/issues) — event hooks, plan mode, subagents
- [Claude Code Issues](https://github.com/anthropics/claude-code/issues) — AGENTS.md, ACP, tool scoping

---

Created by Octocode MCP https://octocode.ai 🔍🐙
