# CRITSTORM finish checkpoint

Branch: `feat/finish`. Main must never be pushed. User workflow is sequential units, one dependency tree, one test worker, gated commits and a push after every unit. Read ASSESSMENT.md for the audit and scope decisions. Beads epic: `critstorm-hio`.

## Numbered unit plan (ordered by pull to keep playing)

0. **Assessment — complete** (`critstorm-hio.1`). Read the project; baseline tests/build/default sim; full headless storm and screenshots; section-by-section audit; commit and push this plan before implementation.
1. **A reason for the next click — complete.** (`critstorm-hio.2`) Visible resting core and collector labels; first-run instructions; successive storm goals and core-yield preview; useful workshop/front previews; seed production streams and use fixed game steps. Verify fresh pacing and an unassisted opening through its first bank.
2. **Build your own gold machine — complete.** Ice/Wall unlocks, additional collectors and fee upgrades; real Vault drains and Front event modifiers; tool feedback and event forecast. Account for blocked payouts. Measure collection and hazard exposure with the harness; inspect painted tools and installed routing in Chromium.
3. **Chase the Eye and finish the game — complete.** Third arena with lava/lightning, honest v1 workshop ladder, visible final bank requirement, conserved golden finale, terminal stats/credits and replay. Measure feasible finale banks and Eye performance; browser-check ordinary, failed and winning exits.
4. **Make greed feel enormous — complete.** Camera impact, presentation hit-stop, crit tier typography, bounded sparks/trails, synthesized bank-out/rupture feedback, delayed blow-up so the disaster stays visible, motion/audio control. Capture bank, bust, results and narrow-screen layouts.
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

Units 0–2 are complete. Next is the last unit (`critstorm-hio.6`): the Greed Bell and remembered storms, then final end-to-end verification and cleanup.

## Unit 1 — a reason for the next click

- Added the resting pixel furnace, a labelled collector, world instructions and goals that follow collection → first upgrade → first Auto-Striker → first bank → next core threshold. The live bank-out preview uses cumulative collected essence, so spending cannot reduce it. Removed the obsolete 777 hint and misleading “keep all” label.
- Moved the Auto-Striker action into the visible opening HUD. The workshop now explains the physical loop, puts entry above the ladders, and previews front risks and the route to the Eye.
- Production combat, aim, surge spikes, events, bank landing, effects, sound and sim physics use isolated seeded streams. Bank placement has its own stream so camera jitter and display refresh cannot change where money lands. `?seed=42` reproduces a run; ordinary storms choose a new seed. Game timers now step at 20 Hz like physics.
- The initial physics stream change exposed an existing 62-frame core-to-drain contract. Retained its established seed mapping while isolating the stream; the existing physical-delay regression passes without weakening it. New tests cover real goal transitions, cumulative core accounting across purchases, and interleaved sim determinism/value carry.
- Fresh sim remains exactly at the baseline: seed 42 / 120s, first surge **62.4s**, Stone **81.1s**, **13.06K** collected, one bank/no bust. This unit changes guidance and reproducibility, not economic constants.
- Chromium seed 42 / 150s with deliberate purchases: installed Auto-Striker, reached the first surge by the 40s sample, banked three pots (one **7.38K** at six crits), and projected **7.5 cores** after settling. No page errors. Inspected workshop, opening, bank and machine captures. Headless playback skips GPU draws between captures to reduce server load; physics/game callbacks still execute every fixed step.
- Final short Chromium check after isolating bank placement: two banks by 70s, 3 projected cores, clean console; inspected the corrected Auto-Striker row.
- Gate: 479 tests / 34 files (56.18s), type-check and production build (12.54s). Assessment commit `e60feea` was pushed before implementation.

## Unit 2 — build your own gold machine

- Ice unlocks after 500 collected essence (or Ceramic Liner); Wall after 5K (or full Aegis). Paid nearby Ice/Water increases the core ceiling while it survives; steam removes the buffer immediately. Wealth and machine cells are protected from paint.
- Added paid surface collectors (240 essence; five total), collector polishing (120 initially, −3 fee points), and real side drains from Vault nodes. New drains inherit the current fee. Front upgrades now strengthen actual scheduled events; the footer forecasts the event that will arrive. Strike/Escape exits paint mode and the cursor explains the selected tool.
- Auditing heat found two prototype gaps: crit tiers did not reach deposited gold, and moving molten gold lost its heat. Actual tiers now deposit at 60→650 degrees and hot gold carries temperature when moving. Repeated corner impacts conserve existing wealth, blocked Wall shares enter the loss ledger, and terminal exposed/in-flight gold is explicitly abandoned and reported separately.
- Closed the airborne-collector loophole: gold must rest on material before converting, with lava contact resolved first. Made lava's lateral creep more viscous (5% rather than 30%) so the bust remains a central obstruction with playable flanks. Twelve seed-7 starter deposits: **18,000** clean collected; **0** collected / **18,000** lava loss at the busted centre; **14,739** collected / **3,261** lava loss at +16 cells (**81.9%** retained). Every ledger balances. Grounded core-to-drain fixtures settle within **67 frames** rather than 62; the pacing bot remains an explicitly approximate 3.1s whole-payout queue, with a five-frame physical settle margin, and does not model terrain/event losses.
- `npm run sim -- --mode routing`: side payout 1,000 stays entirely exposed without a side drain, becomes **700 essence** with one; a 30→27% polish pays back after **4,000 raw gold**. Paid coolant caps at **+380** temporary headroom (minimum 532 essence of counted Ice). Across 128 seeds the static intact ceiling comparison moves EV peak from bank-at-6 / **642.24** to bank-at-8 / **2,100.97**. This is an intact-coolant comparison; live Ice melts and deeper rides need Aegis too.
- Fresh pacing still **62.4s** to surge / **81.1s** to Stone / **13.06K** collected at 120s, one bank/no bust. Legacy cohort balance pins remain intact; their known holdout limitations from assessment still apply.
- Chromium: isolated late workshop fixture installed four visible drains, 130 coolant headroom and 4% fee; inspected Ice/Wall, actual acid forecast, and results with **79 exposed gold left behind**. No page errors. Captures remain temporary.
- Gate: **492 tests / 35 files** passed (60.78s); type-check and production build passed (14.31s, 570.95 kB entry / 179.87 kB gzip). Closed the existing airborne-drain bug as well as this unit bead.

## Unit 3 — chase the Eye and finish the game

- Implemented the third workshop front: a three-cell lava floor (960 physical lava cells), stronger yield/pressure, and isolated seeded lightning at 4s then every 6s. The picker previews its danger and final objective.
- A bank wins only in the Eye, with a pre-Forge pot ≥ the final rank's **10B** threshold and an actual tier-eight strike. Pot snapshots remember the highest actual tier and clear it each surge. The surge multiplier remains unbounded. Permanent tier floors cannot counterfeit the final crit; the purchased Lightning Rod can produce it through its real event path.
- The winning pot erupts once into 24 seeded screen-wide bursts, shares sum to the pot, and physical mass stays ≤1,536 cells. Eight seconds of visible gold physics/collection precede terminal accounting, credits and workshop replay. Victory uses the voluntary core bonus and never credits uncollected gold as essence.
- Replaced the saved Glacier ladder slot with Gilded Horizon (real +25% gold rain), preserving all node indices and the profile format. Glacier/endless remain outside this finite arc; no dead front unlock is sold.
- `npm run sim -- --mode finale`: base/multi level 80 + one real rod-sized tier-eight strike banks **179.31B**, clears the final target without Forge bonuses, and survives the 1,000-degree Aegis ceiling. Eye + finale, 400 steps: **1,758ms total / 4.40ms mean** on this box. Unguarded shower burns in lava, with source 10B versus accounted **9,999,999,744** (relative Float32 rounding 0.00000256%).
- Chromium: inspected Eye, golden shower and credits; actual rod-triggered bank **239B**, **13.90B** collected during ending, **7.91K** cores; clean console. Verified workshop return/re-entry and blow-up. The initial check banked an ineligible pot ordinarily, correctly leaving the storm active; adjusted QA timing to wait for the first scheduled bolt, then checked the winning path.
- Gate: **497 tests / 36 files** passed, type-check and production build passed (12.22s; 574.25 kB / 181.13 kB gzip).

## Unit 4 — make greed feel enormous

- Camera shake now moves the simulated world, grates, machine, arcs and type together. Added tier names, bounded seeded square sparks (180 maximum), gold arc tails, smaller capped number pool, legible large numbers, and a BANKED caption placed clear of the instructions.
- High-tier/bank/rupture impact holds the pixel presentation for 70–90ms; physics, heat, payout landing and game timers keep running. A new regression moves valued matter during a held image and verifies the current world is presented on release, with value unchanged.
- Bank-out plays a resolved synth chord and a 1.2s core receipt. Rupture gets 1.6s of visible fire, shards and red type before results. Ordinary endings stop collection at the decision; the golden finale retains its physical collection window. Audio contexts and continuous drones are released with each storm.
- Sound and calm-motion choices persist independently of the old workshop profile. Calm mode disables shake, flashes, hit-stop and CSS animations and reduces particles; the system reduced-motion preference is the default. No sound assets/dependencies added.
- Added phone layouts for the world, workshop ladders, fronts and results. At **390×844**, no horizontal overflow; the bank button occupies y=481→521 in the visible world and shows surge heat when riding. Chromium checked bank, bank-out receipt, rupture, mobile workshop/world, and mute/calm choices across storm changes; clean console. Inspected the corrected bank caption after its first capture touched the guidance.
- This unit changes presentation rather than balance. Its physical-impact-hold regression and the existing seeded economic distributions check that visual pauses do not grant safety or alter payouts.
- Initial full gate had one **5s timeout** in a 3,000-trial surge computation while Chromium shared the CPU; other 497 tests passed. Stopped the browser/server and reran with one worker and a 60s computational timeout, retaining every balance assertion.
- Final gate: **498 tests / 36 files** passed (76.42s), type-check and production build passed (579.07 kB / 182.54 kB gzip).
