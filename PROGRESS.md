# CRITSTORM finish checkpoint

Branch: `feat/finish`. Main must never be pushed. User workflow is sequential units, one dependency tree, one test worker, gated commits and a push after every unit. Read ASSESSMENT.md for the audit and scope decisions. Beads epic: `critstorm-hio`.

## Numbered unit plan (ordered by pull to keep playing)

0. **Assessment — complete** (`critstorm-hio.1`). Read the project; baseline tests/build/default sim; full headless storm and screenshots; section-by-section audit; commit and push this plan before implementation.
1. **A reason for the next click — complete.** (`critstorm-hio.2`) Visible resting core and collector labels; first-run instructions; successive storm goals and core-yield preview; useful workshop/front previews; seed production streams and use fixed game steps. Verify fresh pacing and an unassisted opening through its first bank.
2. **Build your own gold machine — planned.** Ice/Wall unlocks, additional collectors and fee upgrades; real Vault drains and Front event modifiers; tool feedback and event forecast. Account for blocked payouts. Measure collection and hazard exposure with the harness; inspect painted tools and installed routing in Chromium.
3. **Chase the Eye and finish the game — planned.** Third arena with lava/lightning, honest v1 workshop ladder, visible final bank requirement, conserved golden finale, terminal stats/credits and replay. Measure feasible finale banks and Eye performance; browser-check ordinary, failed and winning exits.
4. **Make greed feel enormous — planned.** Camera impact, presentation hit-stop, crit tier typography, bounded sparks/trails, synthesized bank-out/rupture feedback, delayed blow-up so the disaster stays visible, motion/audio control. Capture bank, bust, results and narrow-screen layouts.
5. **Own flair: a storm worth remembering — planned (last unit).** Add one or two original ideas that deepen voluntary risk and personal storm history; state the rationale here. Measure rewards/costs if balance changes; verify persistence and complete a final end-to-end run. Write the final summary at the top, gate, commit, push and clean up browser/server/scratch artifacts.

## Unit 0 evidence

- Baseline: `npx vitest run --maxWorkers=1`: 33 files / 476 tests passed (65.36 s under shared server load).
- `npm run build`: type-check and production build passed; 559.24 kB entry / 175.99 kB gzip. No source edits made during assessment.
- Default 45-minute seed-42 `npm run sim`: 36.84B cumulative essence / 8,583 raw cores / 4,621 attacks (diagnostic economy model, no live surges).
- Fresh pacing, 120s seed 42: first surge 62.4s; full Stone affordable 81.1s; 13.06K collected; 1 bank / 0 busts. Late pacing, 35 min seed 42: 10.30B collected; 139 banks / 117 busts; 4,539 raw cores. This one seed drops from 340 to 129.686 cores/min across 8→35 min; do not confuse the passing multi-seed regression with guaranteed single-run anti-farming.
- Cached Chromium: full 8:09 storm, 2.5 clicks/s, six surge banks, 941 essence, 0 reported hazard losses; bank-out awarded 1.5 cores and next-storm flow preserved them. No page errors. Inspected start, surge, eight-minute world and result screenshots.
- Screenshots live temporarily in gitignored `.checks/`; inspect after each visible unit and remove at completion.
- Beads recovered after initial embedded-store migration warning. Main checkout is this repo; historical path in AGENTS.md is absent.

## Next action

Unit 1 is finished, gated and ready for its push; next is unit 2 (`critstorm-hio.3`): routing/defense/effect wiring. Eye .4, juice .5, flair .6 follow in order.

## Unit 1 — a reason for the next click

- Added the resting pixel furnace, a labelled collector, world instructions and goals that follow collection → first upgrade → first Auto-Striker → first bank → next core threshold. The live bank-out preview uses cumulative collected essence, so spending cannot reduce it. Removed the obsolete 777 hint and misleading “keep all” label.
- Moved the Auto-Striker action into the visible opening HUD. The workshop now explains the physical loop, puts entry above the ladders, and previews front risks and the route to the Eye.
- Production combat, aim, surge spikes, events, bank landing, effects, sound and sim physics use isolated seeded streams. Bank placement has its own stream so camera jitter and display refresh cannot change where money lands. `?seed=42` reproduces a run; ordinary storms choose a new seed. Game timers now step at 20 Hz like physics.
- The initial physics stream change exposed an existing 62-frame core-to-drain contract. Retained its established seed mapping while isolating the stream; the existing physical-delay regression passes without weakening it. New tests cover real goal transitions, cumulative core accounting across purchases, and interleaved sim determinism/value carry.
- Fresh sim remains exactly at the baseline: seed 42 / 120s, first surge **62.4s**, Stone **81.1s**, **13.06K** collected, one bank/no bust. This unit changes guidance and reproducibility, not economic constants.
- Chromium seed 42 / 150s with deliberate purchases: installed Auto-Striker, reached the first surge by the 40s sample, banked three pots (one **7.38K** at six crits), and projected **7.5 cores** after settling. No page errors. Inspected workshop, opening, bank and machine captures. Headless playback skips GPU draws between captures to reduce server load; physics/game callbacks still execute every fixed step.
- Final short Chromium check after isolating bank placement: two banks by 70s, 3 projected cores, clean console; inspected the corrected Auto-Striker row.
- Gate: 479 tests / 34 files (56.18s), type-check and production build (12.54s). Assessment commit `e60feea` was pushed before implementation.
