import {
    buy,
    COLLECTOR_BASE_FEE,
    createState,
    creditEssence,
    valueToEssence,
} from "../src/game/economy";
import {
    brushById,
    fullStrokeCost,
    paintBrush,
} from "../src/game/brush";
import { executeStrike } from "../src/game/auto-striker";
import { endStorm, markFirstSurge } from "../src/game/storm-end";
import { HEAT_DECAY_PER_SEC, Surge, type PotState } from "../src/game/surge";
import { Simulation } from "../src/sim/simulation";
import { bankAtN, type BotStrategy, type StormView } from "./bot-strategy";
import { greedyBuy } from "./storm-simulator";
import { mulberry32, withSeededRandom } from "./rng";

/** fixed timestep used by the reference pacing profile. */
export const PACING_STEP_SEC = 0.05;

/**
 * conservative core-to-drain delay for competent flats routing. real 320x180
 * world parity tests collect core-centred eruptions completely within 62 frames
 * (3.1s at 20Hz); queued value remains physically pending until this delay elapses.
 */
export const PACING_COLLECTION_DELAY_SEC = 3.1;

/** fresh-player click and purchase behavior measured by the §8 pacing gate. */
export interface StormBotProfile {
    readonly name: string;
    readonly manualClicksPerSec: number;
    readonly paintFirstStoneStroke: boolean;
    readonly buyDpsUpgrades: boolean;
}

/** the fresh v0.1 player reference: sustained but plausible 2.5 clicks per second. */
export const FRESH_PACING_PROFILE: StormBotProfile = {
    name: "fresh-2.5-cps",
    manualClicksPerSec: 2.5,
    paintFirstStoneStroke: true,
    buyDpsUpgrades: true,
};

/** configuration for one deterministic fresh-storm pacing run. */
export interface StormBotConfig {
    durationSec: number;
    seed: number;
    profile?: StormBotProfile;
    strategy?: BotStrategy;
    stepSec?: number;
    /** isolated seed for the tiny brush grid; must not perturb combat or surge rolls. */
    physicsSeed?: number;
}

/** inspectable result of one deterministic §8 pacing run. */
export interface StormBotSummary {
    profile: string;
    strategy: string;
    seed: number;
    durationSec: number;
    stepSec: number;
    manualClicksPerSec: number;
    firstSurgeAtSec: number | null;
    firstBrushAffordableAtSec: number | null;
    firstBrushPaintedAtSec: number | null;
    manualActions: number;
    manualAttacks: number;
    brushActions: number;
    attacks: number;
    routedAttacks: number;
    capturedAttacks: number;
    banks: number;
    busts: number;
    brushCellsPainted: number;
    brushEssenceSpent: number;
    brushBankedEssenceDelta: number;
    /** raw value generated outside surges and queued toward the collector. */
    routedValue: number;
    bankedPotValue: number;
    bustedPotValue: number;
    /** raw generated value across world routes, banked pots, and busted pots. */
    generatedValue: number;
    /** raw value still pending in the bounded collection queue at the time limit. */
    pendingValue: number;
    /** value held in a still-live surge pot at the time limit. */
    livePotValue: number;
    /** raw value that reached the collector before its fee. */
    rawCollectedValue: number;
    /** raw value destroyed before collection; currently surge-busted pots. */
    lostValue: number;
    /** collector skim withheld from raw collected value. */
    collectorFeeValue: number;
    finalEssence: number;
    cumulativeEssence: number;
    reachedFirstSurge: boolean;
    rawBlowUpCores: number;
    blowUpCores: number;
}

/** reject invalid timing inputs before a run can hang or silently emit nonsense. */
function validateConfig(durationSec: number, stepSec: number, clicksPerSec: number): void {
    if (!(durationSec > 0) || !Number.isFinite(durationSec)) {
        throw new Error("durationSec must be finite and greater than 0");
    }
    if (!(stepSec > 0) || !Number.isFinite(stepSec)) {
        throw new Error("stepSec must be finite and greater than 0");
    }
    if (!(clicksPerSec > 0) || !Number.isFinite(clicksPerSec)) {
        throw new Error("manualClicksPerSec must be finite and greater than 0");
    }
}

/** expose the live surge through the existing strategy view contract. */
function strategyView(time: number, economy: ReturnType<typeof createState>, surge: Surge): StormView {
    const pot = surge.pot;
    return {
        time,
        economy,
        coreTemp: surge.coreTemp,
        surge: {
            phase: surge.active ? "active" : "idle",
            critCount: pot.crits,
            pot: pot.value,
            multiplier: pot.multiplier,
            coreLoad: surge.coreLoad,
        },
    };
}

/** create the small deterministic grid used only to execute the real brush stroke. */
function createBrushSimulation(seed: number): Simulation {
    return withSeededRandom(seed, () => new Simulation(40, 30));
}

/**
 * run the fresh-player pacing model through real gameplay seams. manual pointer
 * actions accumulate by elapsed time; the first full stone stroke consumes one
 * action instead of attacking, and all strikes flow through executeStrike/Surge.
 */
export function runStormBot(config: StormBotConfig): StormBotSummary {
    const profile = config.profile ?? FRESH_PACING_PROFILE;
    const strategy = config.strategy ?? bankAtN(6);
    const stepSec = config.stepSec ?? PACING_STEP_SEC;
    validateConfig(config.durationSec, stepSec, profile.manualClicksPerSec);

    const economy = createState();
    const stone = brushById("stone");
    const brushCost = fullStrokeCost(stone);
    const brushSim = createBrushSimulation(config.physicsSeed ?? (config.seed ^ 0x6754_22a1));
    const combatRng = mulberry32((config.seed ^ 0x1a2b_3c4d) | 0);
    const surgeRng = mulberry32((config.seed ^ 0x5e6f_7a8b) | 0);

    let firstSurgeAtSec: number | null = null;
    let firstBrushAffordableAtSec: number | null = null;
    let firstBrushPaintedAtSec: number | null = null;
    let manualActions = 0;
    let manualAttacks = 0;
    let brushActions = 0;
    let attacks = 0;
    let routedAttacks = 0;
    let capturedAttacks = 0;
    let banks = 0;
    let busts = 0;
    let brushCellsPainted = 0;
    let brushEssenceSpent = 0;
    let brushBankedEssenceDelta = 0;
    let routedValue = 0;
    let bankedPotValue = 0;
    let bustedPotValue = 0;
    let brushPending = false;
    let rawCollectedValue = 0;
    let collectorFeeValue = 0;
    let lostValue = 0;
    const collectionQueue: Array<{ value: number; collectAtSec: number }> = [];

    /** place generated gold into the bounded physical-routing delay. */
    const queueCollection = (value: number): void => {
        if (!(value > 0)) return;
        collectionQueue.push({
            value,
            collectAtSec: economy.elapsed + PACING_COLLECTION_DELAY_SEC,
        });
    };

    /** collect every queued payout whose deterministic routing delay has elapsed. */
    const collectDue = (timeSec: number): void => {
        while (collectionQueue[0] && collectionQueue[0].collectAtSec <= timeSec + 1e-9) {
            const route = collectionQueue.shift()!;
            rawCollectedValue += route.value;
            const credited = valueToEssence(route.value, COLLECTOR_BASE_FEE);
            collectorFeeValue += route.value - credited;
            creditEssence(economy, credited);
        }
    };

    /** route a completed surge exactly once: banked pots collect, busted pots are lost. */
    const settlePot = (reason: "bank" | "bust", pot: PotState): void => {
        if (reason === "bank") {
            banks += 1;
            bankedPotValue += pot.value;
            queueCollection(pot.value);
            return;
        }
        busts += 1;
        bustedPotValue += pot.value;
        lostValue += pot.value;
    };

    const surge = new Surge(
        {
            onStart: () => {
                if (firstSurgeAtSec === null) firstSurgeAtSec = economy.elapsed;
                markFirstSurge(economy);
            },
            onEnd: settlePot,
        },
        { rng: surgeRng }
    );

    /** reserve the first full stroke as soon as collected essence covers it. */
    const reserveBrush = (): void => {
        if (
            profile.paintFirstStoneStroke &&
            firstBrushPaintedAtSec === null &&
            economy.essence >= brushCost
        ) {
            if (firstBrushAffordableAtSec === null) firstBrushAffordableAtSec = economy.elapsed;
            brushPending = true;
        }
    };

    /** buy at most one dps upgrade after a pointer action when no brush is reserved. */
    const buyDpsUpgrade = (): void => {
        if (!brushPending && profile.buyDpsUpgrades) {
            const upgrade = greedyBuy(economy);
            if (upgrade) buy(economy, upgrade);
        }
    };

    /** advance heat and collection clocks to an exact scheduled time. */
    const advanceTo = (timeSec: number): void => {
        const dt = timeSec - economy.elapsed;
        if (!(dt > 0)) return;
        economy.elapsed = timeSec;
        surge.decayHeat(HEAT_DECAY_PER_SEC * dt);
        surge.tickHeat(dt);
        collectDue(timeSec);
        reserveBrush();
    };

    const frames = Math.ceil(config.durationSec / stepSec);
    for (let frame = 0; frame < frames; frame++) {
        const frameEnd = Math.min(config.durationSec, (frame + 1) * stepSec);
        const scheduledActions = Math.floor(frameEnd * profile.manualClicksPerSec + 1e-9);
        while (manualActions < scheduledActions) {
            const actionTime = (manualActions + 1) / profile.manualClicksPerSec;
            advanceTo(actionTime);
            manualActions += 1;
            if (brushPending) {
                const essenceBefore = economy.essence;
                const bankedBefore = economy.bankedEssence;
                brushCellsPainted = paintBrush(brushSim, economy, stone, 20, 15);
                brushEssenceSpent = essenceBefore - economy.essence;
                brushBankedEssenceDelta = economy.bankedEssence - bankedBefore;
                firstBrushPaintedAtSec = economy.elapsed;
                brushActions += 1;
                brushPending = false;
                buyDpsUpgrade();
                continue;
            }

            manualAttacks += 1;
            attacks += 1;
            executeStrike(economy, surge, combatRng, {
                onSurgeStart: () => undefined,
                onStrike: (result, captured) => {
                    if (captured) {
                        capturedAttacks += 1;
                        return;
                    }
                    routedAttacks += 1;
                    routedValue += result.damage;
                    queueCollection(result.damage);
                },
            });
            const action = strategy.decide(strategyView(economy.elapsed, economy, surge));
            if (action.type === "bank" && surge.active) surge.endSurge("bank");
            reserveBrush();
            buyDpsUpgrade();
        }
        advanceTo(frameEnd);
    }

    const stormEnd = endStorm(economy, "blow-up");
    const livePotValue = surge.active ? surge.pot.value : 0;
    const pendingValue =
        collectionQueue.reduce((total, route) => total + route.value, 0) + livePotValue;
    const generatedValue = routedValue + bankedPotValue + bustedPotValue + livePotValue;
    return {
        profile: profile.name,
        strategy: strategy.name,
        seed: config.seed,
        durationSec: config.durationSec,
        stepSec,
        manualClicksPerSec: profile.manualClicksPerSec,
        firstSurgeAtSec,
        firstBrushAffordableAtSec,
        firstBrushPaintedAtSec,
        manualActions,
        manualAttacks,
        brushActions,
        attacks,
        routedAttacks,
        capturedAttacks,
        banks,
        busts,
        brushCellsPainted,
        brushEssenceSpent,
        brushBankedEssenceDelta,
        routedValue,
        bankedPotValue,
        bustedPotValue,
        generatedValue,
        pendingValue,
        livePotValue,
        rawCollectedValue,
        lostValue,
        collectorFeeValue,
        finalEssence: economy.essence,
        cumulativeEssence: economy.bankedEssence,
        reachedFirstSurge: economy.reachedFirstSurge,
        rawBlowUpCores: stormEnd.rawCores,
        blowUpCores: stormEnd.cores,
    };
}
