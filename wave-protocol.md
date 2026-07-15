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

Codex has subagents (`spawn_agent`, `spawn_agents_on_csv`, `close_agent`, `report_agent_job_result`; agent defs as TOML in `.codex/agents/`) but **no scripted orchestration** — spawning is model-driven, decided inside the parent's reasoning chain. There is no deterministic control flow.

Consequence: **this document is the enforcement.** Sol must uphold by discipline what the Workflow script upholds structurally. Specifically Sol must, unprompted:

- run Guard and honour an abort
- hold the conditional on Fix (skip it when findings are all minor)
- pass each task's spec verbatim to both implementer and reviewer
- refuse to let any worker merge or approve
- do the sequential merge itself

`spawn_agents_on_csv` fits the Implement fan-out — one CSV row per task, `{column}` templating into the instruction, `max_concurrency`, output CSV. It is data-driven fan-out, not control flow: no guard gate and no conditional Fix. Wrap it, don't rely on it.

Concurrency lives in `~/.codex/config.toml`:

```toml
[agents]
max_threads = 4                # default 6
max_depth = 1                  # workers cannot spawn workers
job_max_runtime_seconds = 900
```

`max_depth = 1` matches the wave shape — orchestrator spawns workers, workers spawn nothing.

## Task specs

Each task in a wave carries a spec that names:

- the design.md sections to read first, by number, and the existing modules to read before writing
- what to build, and explicitly what *not* to build (which wave owns the UI, the screen, the routing)
- what to reuse rather than duplicate
- scope: the files it owns
- collision warning naming shared files
- "keep all existing tests green"

The spec is the review contract. Write it once, pass it twice.
