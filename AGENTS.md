# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

**This file and `AGENTS.md` are byte-identical on purpose.** `CLAUDE.md` is read by Claude Code, `AGENTS.md` by Codex. Any edit to one must be mirrored to the other.

**How work ships here: read [`wave-protocol.md`](./wave-protocol.md).** It defines the wave (parallel agents produce PRs, only the orchestrator merges), the invariants, and the model tiering for both Claude Code and Codex. Read it before starting or orchestrating a wave.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:7510c1e2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Mirror issues to GitHub** - `GITHUB_TOKEN=$(gh auth token) bd github sync --push-only` (beads is the source of truth; GitHub is a read-only mirror — never close issues on GitHub directly)
5. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
6. **Clean up** - Clear stashes, prune remote branches
7. **Verify** - All changes committed AND pushed
8. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->

**Beads in worktrees:** do NOT run any `bd` command from a git worktree — the Dolt DB lives only in the main checkout and does not exist there. Run `bd` from `/home/thatmike1/git/critstorm` only.

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**
- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var

## Build & Test

```bash
npm ci                # install (always run this first in a fresh worktree)
npm test              # vitest run — the test suite
npm run build         # tsc --noEmit && vite build
npm run dev           # vite dev server
npm run sim           # tsx sim/run-sim.ts — headless sim harness
```

**Quality gate — both must be green before any commit:**

```bash
npx vitest run
npx tsc --noEmit
```

## Architecture Overview

A browser game built with React 19 + Pixi.js 8, bundled by Vite. TypeScript throughout, tested with Vitest.

- `src/sim/` — the falling-sand cell simulation: materials, cell grid, physics passes. Presentation-free.
- `src/game/` — game model on top of the sim: economy, crit engine, surge, world, collector. Pure functions and state; no rendering.
- `sim/` — headless harness (`run-sim.ts`) for running the simulation outside the browser, used for balance/playtest measurement.
- `design.md` — the design bible. Numbered sections (§2 identity/fun-floor, §4.3 structures, §4.4 storm events, §5 economy, §6 cost bands). **Read the relevant section before implementing anything.**

**Value conservation is the core invariant.** Value moves with cells (Lagrangian carry — use swap paths, never `setCell`). Every source and sink must be accounted for in the ledger.

**Identity guardrail (design §2):** automation ROUTES wealth, it must never de-risk it for free.

## Conventions & Patterns

Non-negotiable:

- kebab-case file and folder names; no dots except the extension
- never use `any`
- JSDoc comments for functions/methods, starting lowercase
- commit messages: one line, all lowercase, prefixed `feat:` / `fix:` / `refactor:` / `chore:`
- NO `Co-Authored-By` or any other attribution lines in commits or PR bodies
- keep the quality gate green; keep all existing tests passing
- determinism: anything random takes a seeded rng and must be unit-testable
- fixed-timestep, dt-scaled logic — never per-frame
