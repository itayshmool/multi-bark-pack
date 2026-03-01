# tools/

Agent runtime tools. This directory is added to `PATH` in every tmux session via `delegation.ts`, so agents can invoke these directly.

> For setup, install, and operational scripts see [`scripts/`](../scripts/README.md).

## `bark`

CLI helper for pup delegation — lets agents spawn sub-agents via the server API.

```bash
bark delegate "fix the login bug"            # same branch as parent
bark delegate "add unit tests" --branch      # isolated branch + PR
```

**Env vars** (set automatically per tmux session):

| Variable | Purpose |
|----------|---------|
| `BARK_AGENT_ID` | Current agent's ID (required) |
| `BARK_API` | Server URL, e.g. `http://localhost:3333` (required) |
| `BARK_TOKEN` | Auth token when `API_SECRET` is set (optional) |

Calls `POST /api/agents` with the task and parent ID. Uses `python3` for JSON escaping.
