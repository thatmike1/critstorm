# critstorm × powder — game design

Working title: **CRITSTORM**. A push-your-luck incremental where crit payouts erupt as physically
simulated molten gold into a living falling-sand world. The risk is not an RNG roll — it is
emergent physics you can see coming and fight with terrain.

Comps: Nodebuster (run structure, price point, length), The Gnorp Apologue (particle-sim economy,
watchability). Differentiator: Gnorp renders wealth as matter; critstorm makes matter **mortal**.
Gold can burn, boil away, dissolve — and defending it is the game. Bank-or-ride tension where the
bust is physical, and defense is spatial. Identity guardrail: any feature that makes gold safe by
default erodes the differentiator — automation should route wealth, never de-risk it for free.

---

## 1. Pillars

1. **The payout is matter.** Currency never appears as an abstract number tick. Every unit of
   value is particles in the world: erupted, pooled, melted, lost, collected. If a number changes,
   something physical caused it.
2. **The bust is physics.** No hidden "bust roll". Riding a crit chain heats the world through the
   sim's real thermal model. Fire spreads, ice melts, your gold pool is physically at risk. You
   can watch disaster approach and fight it.
3. **Greed is the verb.** Every interesting decision reduces to "bank it or ride it" — at the
   surge level, the storm level, and the meta level.
4. **Casino soul, pixel body.** Critstorm's slot-cabinet identity (gold ramps, jackpot eruptions,
   frenzy) rendered in powder-lab's pixel-native language. No SaaS chrome, no smooth-gradient neon.

## 2. Core loop

Moment to moment (~10 s):

1. **Strike.** Click anywhere in the strike zone around the storm core. Rolls the existing crit
   chain (consecutive crit rolls → tier 0–8).
2. **Erupt.** Payout erupts from the core toward the cursor as molten gold particles. Mass scales
   with log(payout); temperature scales with tier. High tiers spray lava droplets and lightning.
3. **Cool & pool.** Molten gold flows, splashes off terrain, cools to solid gold powder. Hot
   eruptions ignite flammables and melt defenses on the way.
4. **Collect.** Gold that reaches the collector converts to **essence** (spendable). Gold sitting
   in the world is the unbanked pot — earning nothing, at risk, waiting to be routed.
5. **Spend.** Essence buys in-storm upgrades, defense materials (painted as brushes), and
   structures.

Fun-floor guardrail: outside surges, the per-click decision is **placement** — where the
eruption lands relative to terrain, hazards, and the collector. If playtest shows aim doesn't
actually matter (one "always erupt above the collector" answer), pre-surge play is dead clicking
and needs a fix: shift heat-meter fill toward gold collected rather than raw clicks, and move a
cheap auto-striker into the early-mid storm so hands-on time goes to routing and defense, not
meter-filling. With attackRate gone from in-storm upgrades, manual clicking is the only strike
source until the auto-striker exists — it cannot be a late-game structure.

Session level (one **storm**, 8–35 min):

- Storms escalate: world events raise ambient heat, spawn hazards, erode terrain.
- The storm ends one of two ways:
  - **Bank out** (voluntary): end on your terms, keep everything, +50% core bonus.
  - **Blow up**: the world consumes your unbanked gold; banked essence still converts, no bonus.
- Between storms: spend **storm cores** in the workshop (permanent meta upgrades), pick the next
  storm front.

## 3. The surge (bank-or-ride)

The heart of the game. Replaces critstorm's current frenzy.

- Clicking fills the heat meter (existing mechanic). At 100 a **surge** begins.
- During a surge, every strike adds to a **pot**: non-crit strikes add base damage (no dead
  clicks inside the centerpiece), crits add their payout AND pump the pot multiplier:
  `M = 1.5^n` for n crits landed this surge.
- The pot is never an abstract number (pillar 1): it is molten gold visibly swelling inside the
  core — the core glows brighter and physically bulges as the pot grows.
- The world heats from two sources:
  - **Ambient ramp**: `+q·n²` per second of surge time — mild, deterministic, the anti-stall
    clock. You cannot wait out the heat; ambient only climbs.
  - **Crit spikes**: every surge crit injects a core heat spike scaled by its tier. Tier is
    random, so the spike is random — the same roll that pumps your pot is the one that can bust
    you. This is where the gamble lives: a deterministic ramp alone would make "bank at 95% of
    critical temp" a dominant strategy and kill push-your-luck entirely.
- Physics tells escalate in a fixed, learnable ladder as core temp climbs: ice sweats → water
  steams → plants smoke → oil flashes → world gold shimmers toward melt. Tier floor rises
  (surge crits start at tier ≥ 1). **The physics is the theater; the core temp gauge is the
  instrument.** The gauge shows headroom in "one more crit" units (can a median / a max-tier
  spike still fit?), not a countdown.
- Two exits:
  - **BANK** (spacebar): the entire pot erupts at once as a gold mountain — the spectacle payoff.
    It is now physical and still must survive and be collected. Surge ends, world cools.
  - **Overheat**: if the core exceeds critical temp, the surge detonates — the pot erupts as lava
    and fire instead of gold. You watch the pot burn. Existing world gold near the core melts too.
- Expected value targets (tunable, see §6): riding to n+1 multiplies the pot by 1.5, so riding
  stops being EV-positive once the bust chance on the next crit exceeds ~1/3. Tune the spike
  distribution so that crossover lands at n≈6 with no defenses, n≈10 with a good defense layout.
  Defenses must have legible EV value.

## 4. Systems

### 4.1 New materials

| Material | Behavior |
|---|---|
| MOLTEN_GOLD | Liquid, hot (temp set at eruption). Needs density/movable table entries and lava-style heat-carry on movement (heat is Eulerian — without re-seeding the destination cell, a flowing stream reads cold and freezes mid-air). Ignites flammables. Cools below 150 → GOLD. Touching lava: absorbed (value lost). |
| GOLD | Powder, dense (sinks through water). Carries a per-cell `value` payload. Melts back to MOLTEN_GOLD ≥ 300. Dissolved by acid (lost). Collected at collector. Cell brightness scales with value tier so a rich cell reads richer than a poor one. |
| INGOT | Compacted gold: a GOLD cell buried under ≥N gold neighbors for a few seconds fuses into a static INGOT cell that **consumes those neighbors** — their cells empty, their value merges into the ingot (precedent: sand→glass). Keeps large wealth visually dense instead of flooding the screen. Melting back spreads the value across the molten cells it becomes — one cell must never carry the whole ingot, or a single lava touch silently vaporizes a fortune. |

Value conservation: an eruption of payout `P` distributes `P` across its cells. The value field is
a `Float32Array` parallel to the cell grid, and it is **Lagrangian** — a property of the particle,
unlike heat (Eulerian). Carry contract: `swap()` must move value with the cell; `setCell()` zeroes
value unless the transition explicitly carries it (GOLD↔MOLTEN_GOLD preserve in place); destruction
paths (acid, lava absorption) zero the cell and account the amount as lost. Invariant, enforced by
test: `sum(value field) + collected + lost === total erupted` at every frame.

### 4.2 Defense (painted materials)

Purchased with essence, painted with the mouse like powder-lab brushes. Per-cell pricing.

- **Stone** — cheap baffles, channels gold flows. Insulator.
- **Water** — quenches molten gold fast (turns it solid where it lands — good and bad: solid gold
  doesn't flow to the collector). Boils away under heat.
- **Ice** — cold source, strongest quench, melts under sustained surge heat. Expensive.
- **Wall** — indestructible, very expensive, endgame.
- Hazard interactions come free from the ported sim (acid, oil, plant, gunpowder as world hazards).

### 4.3 Structures (automation)

Placed objects, the incremental automation layer:

- **Collector** — the drain; gold reaching it becomes essence at (1 − fee), fee 30% → 0% via
  upgrades. Additional collectors purchasable.
- **Magnet** — pulls gold powder toward it (magnet mechanic exists in sim). Routing tool.
- **Auto-striker** — replaces critstorm's attackRate: a turret that strikes on a timer.
- **Sprinkler** — periodic water spray; automated defense.
- **Lightning rod** — converts storm-event lightning into free max-tier strikes. Late game.

### 4.4 Storm events (escalation)

Timed world events per storm, replacing the falling-777 bonus with in-world versions:

- **Gold rain** — jackpot event: golden matter falls from the sky, catch it before it lands in
  hazards.
- **Acid drizzle / lava fissure / lightning front** — hazard events that threaten pooled gold.
- Event cadence and severity scale with storm duration — the world itself pressures you to bank
  out before greed kills you.

### 4.5 Storm fronts (arenas)

Meta-selected maps with terrain, hazard mix, and payout modifiers (risk × reward knobs):

1. **The flats** — tutorial front. Open ground, mild events.
2. **The bog** — oil pockets and plant growth; fire risk high, gold-rain frequency high.
3. **The eye** (finale) — lava floor, constant lightning. Win condition lives here.
4. **The glacier** (post-v1 stretch) — free ice everywhere, but water floods the collector;
   +payout modifier. Cut from the v1 critical path: three fronts carry the arc, and glacier is
   the only one whose mechanics (flooding) need new sim behavior rather than existing hazards.

### 4.6 Finale

In the eye: bank a single pot ≥ threshold at max multiplier → triggers the CRITSTORM — a
world-consuming golden storm (screen-scale eruption), stats screen, credits. Post-game: endless
mode with prestige-squared modifiers if we want it; not scoped for v1.

## 5. Currencies & meta

Three tiers; every conversion is a physical game action, not a menu:

1. **Gold** (physical, at risk) — cells in the world. Made by strikes, lost to heat/acid/lava.
2. **Essence** (in-storm, resets) — gold through the collector. Buys in-storm upgrades, brushes,
   structures. Existing upgrade set survives mostly intact (base damage, crit chance, crit multi,
   golden) minus attackRate (now a structure).
3. **Storm cores** (permanent) — `cores = floor(sqrt(bankedEssence / 500))` at storm end.
   `bankedEssence` is **cumulative essence collected this storm** — spending essence on in-storm
   upgrades does not reduce it (otherwise the last stretch of every storm becomes a dead zone
   where buying anything is irrational hoarding-tax). The ×1.5 bank-out bonus applies to
   **cores, after the sqrt** — applied to essence before the sqrt it would only be a ×1.22 core
   bump, too weak to matter. With it on cores, riding to a blow-up costs a third of the storm's
   meta yield, which is a real lever: quitting while ahead must feel smart, not cowardly.
   Every storm that reaches its first surge yields at least 1 core — the first-storm blow-up is
   a teaching moment, not 8 minutes of zero meta progress.

Workshop tracks (core sinks, ~15 nodes each, cost growth ~1.6):

- **Forge** — starting crit stats, eruption value.
- **Vault** — collector fee/count, starting essence.
- **Aegis** — defense brushes unlocked from storm start, heat resistance, core critical temp.
- **Front** — unlock storm fronts 2–4, event modifiers, surge tier floor.

Target pacing: first storm ~8 min, blow-up likely (teaching moment). Storms lengthen toward
25–35 min as Aegis makes deep rides survivable. Finale reachable at 5–7 h total. That is the
Nodebuster shape: short runs, visible meta progress every run, finite designed ending.

## 6. Economy model & tuning

Formulas (initial constants — all go through the sim harness before we trust them):

- Payout: `P = base × critMulti^tier × (golden ? 25 : 1)` (existing, keep).
- Eruption mass: `m = clamp(4 + 6·log10(P), 4, 64)` cells, value `P/m` per cell. Spectacle scales
  sublinearly so late game doesn't drown the sim.
- Eruption temperature by tier — anchored to the ported thermal constants
  (oil ignites 150, plant 170, wood 220, sand→glass 220, lava emits 700):

  | tier | temp | world effect |
  |---|---|---|
  | 0–1 | 60–90 | safe, cools fast |
  | 2–3 | 130–170 | ignites oil, then plant |
  | 4–5 | 210–260 | ignites wood, vitrifies sand |
  | 6–7 | 330–450 | melts world gold nearby, lava droplets |
  | 8 | 600+ | lightning strike, lava spray |

- Surge: pot multiplier `1.5^n`; ambient heat during surge `+q·n²` per second (quadratic
  anti-stall clock) plus a per-crit core heat spike scaled by tier (the stochastic bust risk —
  see §3). Core critical temp raised by Aegis.
- Collector fee 30% base; magnet + fee upgrades should beat manual routing by mid-storm.
- In-storm cost growth: keep 1.15–1.35 band from current `economy.ts`, rebased so the first
  defense brush is affordable ~90 s in.
- Essence/min should grow ~×10 per 10 min inside a storm (standard incremental pace), delivered
  mostly through multiplier growth + collection efficiency rather than raw base damage.

Tuning harness: extend `sim/run-sim.ts` into a headless storm simulator with bot strategies
(never-ride, always-ride, bank-at-n) and assert EV crossover points land where §3 says. Two more
assertions beyond the crossover:

- **Anti-farming**: cores/min must strictly increase with storm depth across the target arc
  (8 → 35 min). sqrt(essence) is concave, so if in-storm essence growth ever flattens, spamming
  tiny storms becomes the optimal core grind — the harness must catch that before a player does.
- **Bust hazard shape**: P(bust on next crit) as a function of n must cross 1/3 near the target
  bank points (n≈6 undefended, n≈10 defended) — this is what makes banking early rational at all.

Economy changes must ship with a harness run. This is the difference between "planned economy"
and "vibes".

## 7. Tech plan

- Port `Simulation.ts` + `materials.ts` from powder-lab into `src/sim/`. Zero React deps, but
  **not headless as-is**: the `Simulation` constructor creates canvases via
  `document.createElement` and the render path is ImageData/canvas2D. The port must split the
  sim core (cells/heat/step/typed arrays) from the canvas render layer — the core exposes the
  raw pixel buffer, no DOM. This split is load-bearing twice over: the Pixi layer only needs the
  buffer, and the §6 headless harness runs under Node where `document` does not exist. Keep
  powder-lab's tests against the extracted core.
- Render the sim's pixel buffer into a Pixi texture (nearest-neighbor upscale) as the bottom
  layer of the existing `CritEngine` stage; floating crit numbers and effects stay on top.
- Eruptions are ballistic, and the sim has **no velocity** — every powder-lab cell moves ≤1 cell
  per frame under gravity. So eruption flight is a Pixi-layer projectile phase (arcs toward the
  cursor, tier-scaled spread) that converts to MOLTEN_GOLD grid cells on impact. Cheaper, more
  spectacular, and avoids teaching the cellular sim ballistics it was never built for.
- Grid ~320×180 upscaled; powder-lab already runs this hot loop on typed arrays. Perf worst case
  is **the eye**: lava self-wakes every frame (`updateLava` calls `wake` unconditionally), so a
  lava floor keeps most chunks permanently active and the dirty-chunk scheduler buys nothing —
  benchmark that scene specifically, not the flats.
- Add the value field + MOLTEN_GOLD/GOLD to the sim as first-class materials (density, conduct,
  melt/freeze points in the existing tables) plus the Lagrangian value-carry contract from §4.1
  (swap moves value; setCell zeroes it unless the transition carries it).
- Save system: storm cores + workshop only (storms are ephemeral) — localStorage, tiny surface.
- Audio: extend the oscillator synth; the eruption/quench/sizzle layer maps to sim events.

## 8. v0.1 vertical slice (proves the fantasy)

Smallest build where the pitch is visible in a 10-second clip:

1. Sim ported and rendering under the Pixi stage.
2. Strikes erupt molten gold with tier-scaled temperature; gold cools, pools.
3. One collector, gold→essence, essence buys crit upgrades + stone/water brushes.
4. Surge with pot, BANK button, physical overheat bust — including the minimal HUD (pot swell,
   multiplier, core temp gauge); the bust is not a fair gamble if you can't read it.

No meta, no fronts, no structures beyond the collector. Pacing gate: the first surge must be
reachable within ~90 s of a fresh start — pre-surge clicking is the weakest moment of the loop,
and the slice fails if the tester quits before seeing the actual game. If this slice isn't fun,
nothing above it will save the game.

## 9. Open questions (non-blocking, decided by playtest)

1. Strike aiming: full cursor aim vs. fixed core with aimed spray direction — slice both, pick by feel.
2. Does solid gold flow to the collector by gravity alone, or is the magnet mandatory kit? Affects
   how much routing busywork exists early.
3. MAX_TIER stays 8 or extends to 10 as a Front meta unlock.
