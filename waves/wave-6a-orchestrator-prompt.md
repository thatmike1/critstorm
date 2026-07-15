# Wave 6a Codex orchestrator prompt

Run Critstorm wave 6a using `wave-protocol.md` and the Codex wave runner. This message is my human green light for `critstorm-wave-6a` only. Do not begin wave 6b.

First verify the definition with `npm run wave:6a -- --check`, then execute `npm run wave:6a -- --green-lit critstorm-wave-6a`. The runner owns Guard, isolated implementation, independent comment-only review, conditional Fix, gates, commits, pushes, and PR creation. Do not write implementation code yourself and do not replace or bypass a failed runner phase.

If Guard aborts or any task pipeline fails, do not integrate anything. Preserve diagnostic state, report the exact failure, and stop.

Only after the runner returns a `ready-to-integrate` manifest, integrate as the orchestrator in this order:

1. `critstorm-gen.1`
2. `critstorm-npq.1`
3. `critstorm-j5g.2`
4. `critstorm-j5g.3`

Rebase each subsequent branch on the moved `main`, resolve declared collisions in-session, and run `npx vitest run` plus `npx tsc --noEmit` at every rebased branch head before merging. Workers never merge or approve.

After all PRs are integrated, delete their remote branches, close the four beads issues and their completed epics where appropriate, sync beads to GitHub as required by AGENTS.md, commit only the scoped beads export, pull with rebase, push, and verify `main` is up to date with `origin/main`. File the single wave status issue required by `wave-protocol.md`, then report the landed PRs, validation, collisions resolved, and any remaining gaps.
