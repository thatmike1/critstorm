# CRITSTORM

A push-your-luck incremental where crit payouts erupt as physically simulated molten gold into a
falling-sand world. The bust isn't a hidden RNG roll — it's heat you can watch spread, and terrain
you can fight it with.

Browser game: React 19 + Pixi.js 8, TypeScript, Vite.

## The loop

**Strike** anywhere in the zone around the storm core. Payout erupts toward your cursor as molten
gold — mass scales with the payout, temperature with the crit tier. Gold flows, splashes off
terrain, cools into solid powder. Whatever reaches the **collector** becomes essence you can spend;
whatever sits in the world is unbanked and at risk. Hot eruptions ignite flammables and melt your
own defenses on the way down.

Clicking fills a heat meter. At 100 a **surge** starts: every crit pumps a pot multiplier
(`1.5^n`) and injects a heat spike scaled by its tier. Ambient heat also climbs on its own, so you
can't wait it out. Bank the pot, or ride one more crit.

Storm pressure grows with time. Leave in one of two ways: **bank out** voluntarily (+50% core bonus) or
**blow up** and lose the unbanked gold. Storm cores buy permanent upgrades in the workshop between
runs. Unlock the Bog, then the Eye. In the Eye, bank one pot of at least **10B** containing an
actual **tier 8** strike to trigger the golden finale and credits. The pot multiplier is unbounded;
workshop tier floors do not count as the actual tier 8. A Lightning Rod can catch one for you.

**Space** banks a live surge. **Escape** returns from painting to striking. Ice and Water near the
core provide temporary heat headroom; melting or boiling removes it. Additional collectors open
new routes, and polishing reduces their skim. Collected essence—not your unspent balance—earns
cores. Gold left on the field at departure stays behind.

For reproducible checks use `?seed=42`; `?front=eye` and `?lv=base,chance,multi,auto,golden` are QA
shortcuts. `npm run sim -- --mode routing` measures paid routes/coolant;
`npm run sim -- --mode finale` checks the winning bank and Eye physics budget.

**Core invariant:** value is conserved. It moves with cells (Lagrangian carry, via swap paths —
never `setCell`), and every source and sink is accounted for in the ledger.

## Running it

```bash
npm ci
npm run dev       # vite dev server
npm run build     # tsc --noEmit && vite build
npm test          # vitest run
npm run sim       # headless sim harness — balance/playtest measurement
```

## Layout

| Path | What's in it |
| --- | --- |
| `src/sim/` | falling-sand cell simulation — materials, grid, physics passes. Presentation-free. |
| `src/game/` | game model on the sim — economy, crit engine, surge, world, collector. Pure state, no rendering. |
| `sim/` | headless harness (`run-sim.ts`) for running the simulation outside the browser. |
| `design.md` | the design bible — numbered sections; read the relevant one before implementing. |
| `wave-protocol.md` | how work ships here (parallel agents produce PRs, orchestrator merges). |

## Conventions

kebab-case filenames, no `any`, lowercase JSDoc, one-line lowercase commit messages. Anything
random takes a seeded rng and must be unit-testable; logic is fixed-timestep and dt-scaled, never
per-frame. `npx vitest run` and `npx tsc --noEmit` are the gate — both green before any commit.
