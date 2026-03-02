# scripts/

All shell scripts for setup, operations, and utilities. None of these are part of the TypeScript build.

> For agent runtime tools (added to PATH in tmux sessions), see [`tools/`](../tools/README.md).

## Quick Reference

| Script | Interactive | Purpose |
|--------|:-----------:|---------|
| `start.sh` | No | Auto-restart server wrapper (supports `--path=`) |
| `setup.sh` | Yes | First-run wizard: prerequisites + platforms + `.env` |
| `prerequisites.sh` | Yes | Install system deps (Node, tmux, yarn, Claude CLI, whisper) |
| `prerequisites-wix.sh` | Yes | Wix variant: sets internal npm registry, then runs `prerequisites.sh` |
| `install-backends.sh` | Yes | Install + authenticate all 4 LLM backend CLIs |
| `install-whisper.sh` | No | Install ffmpeg + whisper.cpp + multilingual model |
| `ensure-server.sh` | No | Crontab-friendly: start the server if it's not running |
| ~~`run-on-repo.sh`~~ | — | Merged into `start.sh --path=` |
| `gather-cursor.sh` | No | Export Cursor CLI auth to a tarball (for migration) |
| `restore-cursor.sh` | No | Import Cursor CLI auth from a tarball |
| `use-wix-registry.sh` | No | Swap yarn.lock to Wix internal npm registry |

---

## Setup & Install

### `setup.sh`

Interactive first-run wizard. Checks prerequisites, runs `yarn install`, configures chat platforms (WhatsApp, Telegram, Slack), and writes `.env`.

```bash
./scripts/setup.sh
```

### `prerequisites.sh`

Installs system-level dependencies: Homebrew, Node.js 18+, yarn, tmux, Claude Code CLI, ffmpeg, whisper-cpp, and `yarn install`. Supports `--yes` for non-interactive mode.

```bash
./scripts/prerequisites.sh         # interactive
./scripts/prerequisites.sh --yes   # auto-accept required, skip optional
```

### `prerequisites-wix.sh`

Thin wrapper: sets `WIX_MODE=true` then sources `prerequisites.sh`. Restores Wix-internal lock files before `yarn install`.

```bash
./scripts/prerequisites-wix.sh [--yes]
```

### `install-backends.sh`

Interactive installer for all 4 LLM backend CLIs (Claude Code, Cursor, Codex, Gemini). Checks availability, installs, runs auth flows, and updates `ENABLED_BACKENDS` / `DEFAULT_BACKEND` in `.env`.

```bash
./scripts/install-backends.sh               # interactive
./scripts/install-backends.sh --yes         # auto-accept
./scripts/install-backends.sh --skip-auth   # install only, no auth
```

### `install-whisper.sh`

Installs ffmpeg + whisper-cpp via Homebrew, downloads the multilingual base model (~142MB), removes the old English-only model, and runs a quick validation test.

```bash
./scripts/install-whisper.sh
```

### `use-wix-registry.sh`

Restores `yarn.lock.wix-backup` (and `package-lock.json.wix-backup` if present) for Wix employees using the internal npm registry.

```bash
./scripts/use-wix-registry.sh
yarn install
```

---

## Operations

### `start.sh`

All-in-one server launcher. Handles preflight checks (node, tmux, yarn, `node_modules`, TypeScript build, `.env`), symlinks the target repo into `projects/`, then runs `node dist/server/index.js` in an auto-restart loop. Exit code 0 restarts after 3s, non-zero stops. Ctrl+C passes through cleanly.

```bash
yarn start                         # run on the current directory
yarn start --path=/path/to/repo    # run on a specific repo

# Direct invocation:
./scripts/start.sh                         # current directory
./scripts/start.sh --path=/path/to/repo    # specific repo
```

Without `--path`, the script uses the caller's current working directory. The target repo is symlinked into `projects/<repo-name>` so pups can work on it.

### `ensure-server.sh`

Crontab-friendly watchdog. Checks if port 3333 is in use; if not, starts the server via `start.sh` in the background. Rotates its own logs.

```bash
# Add to crontab for auto-recovery:
* * * * * /path/to/scripts/ensure-server.sh
```

Logs: `.bark-tmp/ensure-server.log` (100KB max), `.bark-tmp/server.log` (5MB max).

---

## Utilities

### `gather-cursor.sh`

Exports Cursor CLI auth tokens and config into `/tmp/cursor-auth.tar.gz`. Collects from `~/.cursor/`, `~/.cursor-agent/`, Application Support, and Keychain. Only files <1MB.

```bash
./scripts/gather-cursor.sh
scp /tmp/cursor-auth.tar.gz user@other-mac:/tmp/
```

### `restore-cursor.sh`

Restores Cursor auth from the tarball created by `gather-cursor.sh`. Uses `cp -n` (no-clobber) for config files. Keychain entries require manual import.

```bash
./scripts/restore-cursor.sh /tmp/cursor-auth.tar.gz
```
