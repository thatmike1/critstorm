# CRITSTORM assessment — 1 October 2026

Mike's verdict is still the right diagnosis: the physical hook works; the player needs a clearer destination, more ways to shape a storm, and moments they want to show someone. This is a finish pass on the existing game, not a new engine.

## Baseline and method

Read README.md, all numbered design sections, wave-protocol.md, and both byte-identical agent instruction files. Work is sequential in the main checkout on `feat/finish`: the user's single-copy, resource-limited unit workflow supersedes the parallel worktree wave procedure. Main will not be pushed.

Installed the locked dependencies with `npm ci`. Baseline: **476 tests in 33 files pass**, one Vitest worker; production build and type-check pass. Build reports a 559 kB entry chunk (176 kB gzip); this is a loading concern rather than a failed build. Ran the default `npm run sim`, fresh pacing and late pacing modes. Default 45-minute seed-42 diagnostic sim: 36.84B cumulative essence, 8,583 cores, 4,621 attacks; it explicitly omits live surges. Fresh `--mode pacing --duration 2 --seed 42`: first surge 62.4s, full Stone brush 81.1s, 13.06K cumulative essence, one bank/no bust. Late `--mode late-pacing --duration 35 --seed 42`: 10.30B cumulative essence, 139 banks/117 busts, 4,539 raw cores. Its cores/min falls from 340 at 8 min to 129.686 at 35 min on this jackpot-heavy seed; existing multi-seed gates pass, but single-run depth is not reliably rewarded.

Played a full **8:09 storm in cached headless Chromium**, controlled 20 Hz animation frames at 2.5 clicks/s, aimed at the central drain, deliberately without purchases to isolate opening feedback. Banked six surges (including a ×3.38/3-crit pot), collected **941 essence**, zero hazard loss reported, banked out for **1.5 cores**, and returned to a workshop wallet of 1.5. No page errors. Screenshots inspected at start, surge, eight-minute world and results, temporarily in gitignored `.checks/` (204 kB total). This conservative browser run is not the greedy upgrade bot; their different yields are expected.

Beads initially reported an embedded Dolt migration failure; `bd create` subsequently imported the existing 68 issues successfully. Tracking uses epic `critstorm-hio` and child units. The instruction's historical `/home/thatmike1/...` checkout does not exist on this box; all bd calls use the actual main checkout `/root/git/critstorm`, with no changes outside this repo or `/tmp`.

## Design coverage

| Design section | Built | Missing or weak | Finish decision |
| --- | --- | --- | --- |
| §1 pillars | Currency is simulated matter; real heat, lava and acid losses; casino cabinet styling. | The quiet world has no visible core; numbers float far from their source; no destination beyond upgrades. | Keep the powder/casino identity, make origin and goals readable. |
| §2 core loop | Aimed ballistic strikes, pooling gold, collection-only essence, purchases, bank-out, workshop. | No first-run explanation; automation hidden below the fold; stale 777 hint. Aim above the central drain is usually the obvious answer. | Guide first five minutes; expose milestones and risk; extend spatial routing tools. |
| §3 surge | Physical swelling pot, compounding multiplier, random tier heat spikes, ambient ramp, readable headroom, gold bank volley, lava bust. | Fresh crits are rare; the pot lacks a strong landing beat. A full storm blow-up uses an interim unbanked-gold threshold. | Preserve measured surge math; make decisions and exits more legible and spectacular. |
| §4.1 materials | Molten gold/solid gold, melt/freeze carry, rich-cell brightness, value array, loss/settle listeners and extensive invariant tests. | INGOT absent. Projectile landing drops skipped Wall shares instead of accounting for them. Physics still uses global Math.random. | Fix seed and blocked-payout accounting; defer ingot compaction: bounded bank mass already prevents flooding, and static compaction risks making routes worse. |
| §4.2 defense | Stone and Water with per-cell charges and working Aegis discounts. | Ice and Wall absent; no tool preview or simple return-to-strike control. | Add earned Ice/Wall access and an explicit strike tool; preserve value when painting. |
| §4.3 structures | Magnet, early Auto-Striker with upgrades/overclock, paid Sprinkler, Lightning Rod. | Extra collectors absent despite Vault purchases; no collector purchase or meaningful in-storm fee upgrade. | Wire permanent drains and purchasable routing/efficiency. Automation still leaves wealth exposed to hazards. |
| §4.4 events | All four types, escalating cadence/severity, seeded scheduler and front weights. | Front event modifiers are sold but ignored; events are largely unannounced. | Wire modifiers and forecast/tell events without a hidden bust roll. |
| §4.5 fronts | Flats and Bog, seeded oil/plant terrain, workshop selection. | Eye sold but absent; Glacier sold despite explicit post-v1 stretch status. Front differences not explained in picker. | Ship Eye as third/final front. Replace unavailable Glacier node with a real v1 effect while preserving save indices. |
| §4.6 finale | Nothing. | No win condition, golden world finale, stats or credits. | Build a finite ending with explicit progress and an achievable, measured bank target. |
| §5 currencies/meta | Spendable vs cumulative essence, sqrt cores, ×1.5 after sqrt, first-surge floor, 60 workshop nodes, resilient saves. | Dead drains/event/front nodes; no run records or long-term achievement goal. Bank-out says “keep all” although only collected essence converts. | Make every offered node do something; honest extraction wording; persistent accomplishments and next-run pull. |
| §6 balance | Real surge harness, fresh bot, 129-seed late-arc/overclock regressions, anti-farming checks. | Default storm harness is a diagnostic economy approximation, omitting live surges/events/routing; not proof of whole-game completion time. | Keep the established curve; add focused measurements for new sinks/front/finale and report model limits. |
| §7 tech | Headless typed-array sim, Pixi buffer texture, projectile flight, 20 Hz physics, tiny profile, oscillator synth, performance benchmark. | Game timers run variable frame deltas; production combat/physics/VFX RNG not isolated; no reduced-motion setting. | Seed independent streams and fix game-step timing; bounded effects and accessible motion/sound controls. |
| §8 vertical slice | All four slice capabilities exist with pacing regression tests. | Opening is a blank sky and a dense disabled shop; the hook is not explained. | Bring the fantasy into view immediately and lead into the first surge. |
| §9 open questions | Cursor-directed impact plus tier spread; solid gold falls to the narrow drain; MAX_TIER=8. | Magnet routing on flat settled piles can be finicky. | Retain tier cap and aiming; more drains, tool feedback, forecasts and optional spatial challenges. |

## Player judgement

The first screen is a workshop with four large ladders, an empty wallet, and no account of what I am about to do. The storm then shows mostly empty sky over grey terrain. There is no resting core to click. “Click fast → surge” is the only direction; “catch falling 777” is obsolete. Important decisions, especially Auto-Striker, sit below the visible shop. This spends curiosity before demonstrating the hook.

The first five minutes need successive, concrete purposes: see gold reach a labelled drain, buy a useful upgrade, ignite and bank a pot, place automation, build a defense, chase the next core threshold. A storm should visibly become a machine I built. The next storm should promise a new route, a permanent improvement, or progress toward the Eye, instead of a fresh empty sky.

A shareable clip needs a readable setup and reversal: a visibly swollen pot; “one more” risk; a jackpot that showers the world with gold; or a bank withheld a beat too long, followed by a physical red detonation. The existing typography/flash is a start, but shaking only floating numbers leaves the world weightless, and an immediate results screen can hide the explosion.

## Scope and tradeoffs

Finish the finite three-front game. Keep the existing 8–35 minute economic arc rather than replacing it with an unmeasured idle shortcut. The 5–7 hour completion target is a design aspiration, not something a short headless bot can honestly certify; measure threshold feasibility and name that limitation. No endless prestige, Glacier flooding, asset downloads, extra dependency trees or worktrees. INGOT stays deferred pending a dedicated value/melt design because bounded cell mass already solves its immediate performance motivation.

Own flair should amplify greed and physical wealth, not mint safe passive money: one optional, visible risk challenge and one memory of the storms the player survived. Detail and rationale land in the final unit.

## Completion audit

The six units in PROGRESS.md now resolve the prioritized opening, routing, defense, workshop/front, finale, timing/RNG and presentation gaps above. The final original mechanics are the Greed Bell's paid heat wager and bounded replayable storm keepsakes. All 503 tests, type-check and build pass; physical routing/finale benches, paired Bell cohorts and fresh/finale browser play are recorded in the checkpoint.

The original assessment remains an account of the starting prototype. INGOT, Glacier and endless prestige remain intentionally outside this finite version. The design's 5–7 hour human arc and existing balance holdout deficits still need measurement, not an invented certification: follow-up bead `critstorm-thv` asks for three fresh human sessions before further cost tuning.
