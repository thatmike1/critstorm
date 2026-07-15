import type { WaveDefinition } from "../scripts/codex-wave-runner";

const COMMON_CONVENTIONS = [
    "Repo conventions (non-negotiable):",
    "- kebab-case file names, no dots except extension",
    "- never use `any`; add concise lowercase JSDoc directly above functions and methods",
    "- commit messages are runner-owned; do not commit from a worker",
    "- no Co-Authored-By or other attribution lines",
    "- do not run any `bd`, `git push`, or `gh` mutation from a worker",
    "- keep all existing tests green",
].join("\n");

/** Codex-native definition of the human-green-lit wave 6a pipeline */
const definition: WaveDefinition = {
    name: "critstorm-wave-6a",
    repo: "/home/thatmike1/git/critstorm",
    baseBranch: "main",
    models: {
        implement: { id: "gpt-5.6-terra", effort: "high" },
        review: { id: "gpt-5.6-terra", effort: "high" },
        fix: { id: "gpt-5.6-terra", effort: "high" },
    },
    qualityGate: ["npx vitest run", "npx tsc --noEmit"],
    dependencyChecks: [
        {
            path: "src/game/economy.ts",
            pattern: "export function coresFromEssence",
            description:
                "wave 5b dependency missing: origin/main must export coresFromEssence",
        },
    ],
    maxConcurrency: 4,
    mergeOrder: [
        "critstorm-gen.1",
        "critstorm-npq.1",
        "critstorm-j5g.2",
        "critstorm-j5g.3",
    ],
    tasks: [
        {
            id: "critstorm-gen.1",
            branch: "wave-6a/gen-1-storm-cores",
            title: "storm cores conversion + bank-out bonus",
            commitMessage: "feat: add storm cores conversion and bank-out bonus",
            collisionFiles: ["src/app.tsx"],
            spec: [
                "Read design.md §2 and §5 in full first, then src/game/economy.ts (coresFromEssence exists from wave 5b — reuse it, do not duplicate).",
                "- At storm end: cores = coresFromEssence(bankedEssence), where bankedEssence is CUMULATIVE essence collected this storm (spending on in-storm upgrades does not reduce it — track it separately from the spendable balance if not already).",
                "- Bank-out bonus: ending voluntarily multiplies CORES by 1.5 (after the sqrt, design §5 — applied to essence it would be a worthless x1.22). Blow-up: no bonus, banked essence still converts.",
                "- Floor: every storm that reached its first surge yields at least 1 core (the first-storm blow-up is a teaching moment, not zero progress).",
                "- This wave builds the MODEL + a minimal end-of-storm accounting seam (pure functions + state), NOT the results screen or workshop UI (those are npq.2 / gen.2). Keep it presentation-free and fully unit-tested.",
                "- Scope: src/game/economy.ts + a new src/game/ module + tests. Do NOT touch app.tsx UI beyond a minimal state hook if unavoidable.",
                "- Keep all existing tests green.",
                COMMON_CONVENTIONS,
            ].join("\n"),
        },
        {
            id: "critstorm-npq.1",
            branch: "wave-6a/npq-1-storm-events",
            title: "storm event system with escalating cadence",
            commitMessage: "feat: add escalating storm events",
            collisionFiles: ["src/app.tsx"],
            spec: [
                "Read design.md §4.4 first, then src/game/crit-engine.ts (spawnBonus — the falling-777 bonus this replaces conceptually), src/sim/materials.ts, src/game/world.ts.",
                "- A per-storm event scheduler: timed world events whose cadence and severity scale with storm duration (the world pressures you to bank out).",
                "- Ship these events: gold rain (golden matter falls from the sky — value-carrying gold cells spawned at the top, catch value before it lands in hazards), acid drizzle (acid cells rain over a band), lava fissure (lava wells up from a floor crack). Lightning front can be a stub type for later.",
                "- Events act through the existing sim (paint cells, seed heat) — no new materials. Gold rain must route through the value field with conservation (spawned value is 'erupted' in the ledger).",
                "- Deterministic scheduler given a seeded rng; unit-test cadence escalation and each event's sim effect.",
                "- Scope: a new src/game/storm-events module + minimal wiring in app.tsx frame loop + tests. Do NOT touch src/game/surge.ts or economy constants.",
                "- Keep all existing tests green.",
                COMMON_CONVENTIONS,
            ].join("\n"),
        },
        {
            id: "critstorm-j5g.2",
            branch: "wave-6a/j5g-2-magnet",
            title: "magnet structure: gold routing",
            commitMessage: "feat: add placeable gold-routing magnet",
            collisionFiles: ["src/app.tsx"],
            spec: [
                "Read design.md §4.3 first, then src/sim/simulation.ts (the sim has a magnet mechanic — find it), src/game/collector.ts, and the brush purchase flow from j5g.1 (src/game/ + app.tsx).",
                "- A placeable magnet structure purchased with essence: pulls GOLD powder cells toward it — the routing tool that beats manual aim by mid-storm (design §6).",
                "- Reuse the sim's existing magnet behavior if present; otherwise implement attraction as a biased-gravity pass for GOLD cells within a radius. Value must move with the cells (Lagrangian carry — use swap paths, never setCell).",
                "- Placement UI rides the existing brush/purchase flow (a structure is a one-click placement, not a painted material). Render it pixel-native on the sim (a distinct static cell cluster or a small pixi marker consistent with the drain marker from wave 5a).",
                "- Identity guardrail (design intro): the magnet ROUTES wealth, it must not de-risk it — magnetized gold still burns/dissolves normally.",
                "- Tests: attraction moves gold+value toward the magnet, conservation holds, purchase deducts essence.",
                "- Scope: src/sim (attraction pass) + src/game structure module + app.tsx wiring. Coordinate risk: you share app.tsx with other tasks this wave — keep your app.tsx diff minimal.",
                "- Keep all existing tests green.",
                COMMON_CONVENTIONS,
            ].join("\n"),
        },
        {
            id: "critstorm-j5g.3",
            branch: "wave-6a/j5g-3-auto-striker",
            title: "auto-striker structure",
            commitMessage: "feat: add auto-striker structure",
            collisionFiles: ["src/app.tsx", "src/game/economy.ts"],
            spec: [
                "Read design.md §2 (fun-floor guardrail) and §4.3 first, then src/game/crit-engine.ts (erupt with no target = auto-strike at a random strike-zone point), src/game/economy.ts, app.tsx.",
                "- The auto-striker replaces the attackRate upgrade — and YOU remove that upgrade in this task: delete attackRate ('Faster Reels') from the UPGRADES set in src/game/economy.ts and its HUD entry (playtest 2026-07-11: it silently auto-farms 219K DPS at 0 clicks/s, no risk, which trivializes the whole economy; design §5 explicitly drops it). Migrate its dev-cheat query param gracefully. A purchasable turret that strikes on a timer takes its place (rolls the same attack path as a manual click, erupts toward its own aim).",
                "- Design §2 says it CANNOT be late-game: it must be affordable early-mid storm so hands-on time shifts to routing and defense. Price it inside the existing §6 cost band; strike interval upgradeable.",
                "- Auto-strikes fill heat and feed surges exactly like manual clicks (recordStrike capture semantics included — reuse the existing strike path, do not fork it).",
                "- Render the turret pixel-native near the strike zone; a subtle tell when it fires.",
                "- Tests: timer fires strikes at the configured rate (fixed-timestep, dt-scaled, not per-frame), purchase/upgrade costs, strikes route through the shared attack path.",
                "- Scope: a src/game module + app.tsx wiring. Coordinate risk: you share app.tsx with other tasks this wave — keep your app.tsx diff minimal.",
                "- Keep all existing tests green.",
                COMMON_CONVENTIONS,
            ].join("\n"),
        },
    ],
};

export default definition;
