# Wave Protocol

How work ships on this project. Harness-agnostic: Claude Code and Codex both follow it.

A **wave** is a set of beads issues that can be built in parallel, usually grouped under an epic. The protocol exists to let N agents write code simultaneously while zero of them are trusted to integrate it. Agents produce PRs. The orchestrator merges.

## Actors

| Actor | Does | Never |
|---|---|---|
| **Human** | Green-lights each wave. Sets direction. | Touches git. |
| **Orchestrator** (main session) | Plans the wave, spawns workers, then merges sequentially, resolves collisions, closes beads, pushes, files the status issue. | Writes implementation code. |
| **Workers** (spawned) | Guard, implement, review, fix. One bounded task each. | Merge. Approve. Touch another worker's scope. |

## Invariants

These are rules, not description. Violating one invalidates the wave.

1. **Workers never merge.** Integration needs cross-PR context spanning every branch; a worktree agent sees exactly one. Integration is the orchestrator's job, always.
2. **Reviewers cannot approve.** Comment-only (`--comment`), never `--approve` or `--request-changes`. This makes a self-approving PR impossible rather than merely discouraged.
3. **Findings are claims, not facts.** The fixer re-verifies each finding before acting and may reject the reviewer with a stated reason.
4. **The spec string is the contract.** The same task spec goes to the implementer *and* the reviewer, so the reviewer grades against what the implementer was told — not against its own taste.
5. **Collisions are declared, not discovered.** Name the shared files up front, tell each task to keep that diff minimal, and decide merge order before any code exists.
6. **Guard gates semantically.** Verify the previous wave's work exists as a symbol at `origin/main`, not as a line in git log.
7. **Every wave is human-green-lit** before it runs.

## Phases

Tasks flow through 1–4 independently — no barrier between stages. Phase 5 is the orchestrator's.

**1. Guard** — read-only, modifies nothing. Clean tree; main attached and synced to `origin/main`; `gh auth status` ok; quality gate green; the previous wave's dependency present as an exported symbol; record `baseSha`. Any failure aborts the whole wave before implementation spends a token.

**2. Implement** — one worker per issue, isolated worktree, all parallel. `npm ci`, branch from `origin/main`, read the design.md sections named in the spec, build, gate green, commit, push branch, `gh pr create` referencing the beads id.

**3. Review** — no worktree. Reads the head read-only from the main checkout via `git show origin/<branch>:<path>` and `gh pr diff <n>`. Grades against the task spec, the named design.md sections, value conservation, the identity guardrail, scope discipline, test quality, conventions. Posts one comment-only review with `file:line` findings classed `blocker` / `major` / `minor`.

**4. Fix** — conditional; fires only on non-minor findings. Verifies each is real, fixes confirmed ones, rejects the rest with reasons. Gate green, `fix:` commit, push the same branch.

**5. Integrate** — orchestrator only, in the main session:

- merge sequentially in dependency order
- rebase each subsequent branch on the moved main
- re-run the quality gate at each rebased branch head
- resolve collisions in-session (`app.tsx` collides most waves)
- delete remote branches
- `bd close` the issues, then the epic
- commit `.beads`, push
- file one gh status issue for the wave

## Model tiering

Three tiers with a deliberate inversion: the most capable model is also the most token-frugal. It never writes implementation code — it decides, delegates, integrates. The bulk tier does bounded work where the spec already carries the thinking. The cheap tier runs checklists. Intelligence concentrates where leverage per token is highest; token volume goes where it's cheapest.

| Role | Claude Code | Codex |
|---|---|---|
| Orchestrator | Fable 5 | `gpt-5.6-sol`, effort `medium` (raise to `high` for integration) |
| Implement / review / fix | Opus 4.8 | `gpt-5.6-terra`, effort `high` |
| Guard | Haiku 4.5 | `gpt-5.6-luna`, effort `low` |

Do not run the orchestrator at Sol's `ultra` — it auto-delegates, which defeats controlled fan-out.

## Harness: Claude Code

The wave is a `Workflow` script (see `~/.claude/critstorm-wave-4/wave-*.js`). `pipeline()` runs tasks through implement → review → fix with no barrier; `agent()` carries `model`, `effort`, `isolation: 'worktree'`, and a JSON `schema` per phase. The script enforces the invariants structurally — it returns to the orchestrator with a merge order and stops. It cannot merge.

## Harness: Codex

The Codex harness is [`scripts/run-codex-wave.ts`](./scripts/run-codex-wave.ts), driven by a typed definition under [`waves/`](./waves/). The orchestrator invokes it once, then integrates only when it returns a `ready-to-integrate` manifest.

The runner provides the control flow that native model-driven subagents do not:

- Guard is deterministic shell code and aborts before any model runs.
- Each task gets an isolated Git worktree and its own non-interactive `codex exec` process.
- The task spec is one string passed unchanged to Implement and Review.
- Implement and Fix workers only edit files. The runner owns gates, commits, pushes, and PR creation.
- Review runs read-only. The runner alone posts `gh pr review --comment`, so a reviewer cannot approve or request changes.
- Fix receives only blocker/major findings and must disposition every claim.
- Four task pipelines may run concurrently; each advances independently through Implement → Review → optional Fix.
- Workers run with Codex multi-agent delegation disabled.
- The runner stops before integration. The Sol orchestrator rebases, resolves collisions, gates, merges, closes beads, and pushes.

Every execution requires an exact green-light argument. Validation is safe and does not start a wave:

```bash
npm run wave:6a -- --check
npm run wave:6a -- --green-lit critstorm-wave-6a
```

The runner writes its integration manifest to `/tmp/<wave-name>-manifest.json`. An `aborted` or `failed` manifest forbids integration. Failed-task worktrees are deliberately retained for diagnosis; successful-task worktrees are removed after their PR pipeline completes.

## Task specs

Each task in a wave carries a spec that names:

- the design.md sections to read first, by number, and the existing modules to read before writing
- what to build, and explicitly what *not* to build (which wave owns the UI, the screen, the routing)
- what to reuse rather than duplicate
- scope: the files it owns
- collision warning naming shared files
- "keep all existing tests green"

The spec is the review contract. Write it once, pass it twice.
