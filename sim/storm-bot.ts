import {
    buy,
    canBuy,
    COLLECTOR_BASE_FEE,
    coresFromEssence,
    createState,
    creditEssence,
    expectedDamagePerAttack,
    upgradeCost,
    UPGRADES,
    valueToEssence,
    type UpgradeId,
} from "../src/game/economy";
import {
    brushById,
    fullStrokeCost,
    paintBrush,
} from "../src/game/brush";
import {
    autoStrikerInterval,
    autoStrikerStrikeHeat,
    autoStrikerSurgeHeat,
    autoStrikerUpgradeCost,
    canUpgradeAutoStriker,
    createAutoStrikerState,
    executeStrike,
    placeAutoStriker,
    settleAutoStrikerOverclock,
    tickAutoStriker,
    upgradeAutoStriker,
} from "../src/game/auto-striker";
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

/** authoritative late-arc sample marks, including both growth windows. */
export const LATE_PACING_SAMPLE_MINUTES = [8, 15, 20, 22, 25, 29, 30, 35] as const;

/** coarse anti-farming arc from the critstorm-3il acceptance contract. */
export const LATE_PACING_COARSE_MINUTES = [8, 15, 22, 29, 35] as const;

/** quantified critstorm-3il bands; ratios are evaluated on seed medians. */
export const LATE_PACING_TARGETS = {
    minimumEssenceGrowth: 5,
    maximumEssenceGrowth: 20,
    minimumCoarseCoresPerMinGrowth: 0.05,
    minimumThirtyFiveOverThirtyCoresPerMinGrowth: 0.15,
} as const;

/** fresh-player click and purchase behavior measured by the §8 pacing gate. */
export interface StormBotProfile {
    readonly name: string;
    readonly manualClicksPerSec: number;
    readonly paintFirstStoneStroke: boolean;
    readonly buyDpsUpgrades: boolean;
    /** whether the competent purchase policy may place and upgrade the turret. */
    readonly allowAutoStriker: boolean;
    /** whether eligible bank/bust exits settle the turret's ephemeral overclock. */
    readonly allowAutoStrikerOverclock: boolean;
}

/** the fresh v0.1 player reference: sustained but plausible 2.5 clicks per second. */
export const FRESH_PACING_PROFILE: StormBotProfile = {
    name: "fresh-2.5-cps",
    manualClicksPerSec: 2.5,
    paintFirstStoneStroke: true,
    buyDpsUpgrades: true,
    allowAutoStriker: false,
    allowAutoStrikerOverclock: false,
};

/** the long-arc reference profile, including existing physical automation. */
export const COMPETENT_PACING_PROFILE: StormBotProfile = {
    ...FRESH_PACING_PROFILE,
    name: "competent-auto-striker",
    allowAutoStriker: true,
    allowAutoStrikerOverclock: true,
};

/** create the paired long-arc profile used for the auto-striker causal ablation. */
export function competentPacingProfile(
    allowAutoStriker: boolean,
    allowAutoStrikerOverclock = allowAutoStriker
): StormBotProfile {
    return {
        ...COMPETENT_PACING_PROFILE,
        name: !allowAutoStriker
            ? "competent-no-auto-striker"
            : allowAutoStrikerOverclock
              ? "competent-auto-striker-overclock"
              : "competent-auto-striker-no-overclock",
        allowAutoStriker,
        allowAutoStrikerOverclock: allowAutoStriker && allowAutoStrikerOverclock,
    };
}

/** configuration for one deterministic fresh-storm pacing run. */
export interface StormBotConfig {
    durationSec: number;
    seed: number;
    profile?: StormBotProfile;
    strategy?: BotStrategy;
    stepSec?: number;
    /** isolated seed for the tiny brush grid; must not perturb combat or surge rolls. */
    physicsSeed?: number;
    /** exact minute marks at which to snapshot cumulative collection and cores. */
    sampleAtMinutes?: readonly number[];
}

/** one cumulative late-arc sample from collected, never-spent banked essence. */
export interface StormBotSample {
    minute: number;
    cumulativeEssence: number;
    cores: number;
    coresPerMin: number;
    autoStrikerLevel: number;
    autoStrikerOverclockStacks: number;
}

/** median sample row across one deterministic seed sweep. */
export interface LatePacingMedianSample {
    minute: number;
    cumulativeEssence: number;
    coresPerMin: number;
}

/** quantified late-arc result against the critstorm-3il target bands. */
export interface LatePacingReport {
    trials: number;
    samples: LatePacingMedianSample[];
    essenceGrowth20To30: number;
    essenceGrowth25To35: number;
    coarseCoresPerMinGrowth: number[];
    coresPerMin35Over30Growth: number;
    passes: boolean;
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
    firstAutoStrikerAtSec: number | null;
    automaticAttacks: number;
    automaticRoutedAttacks: number;
    automaticCapturedAttacks: number;
    autoStrikerLevel: number;
    autoStrikerOverclockStacks: number;
    autoStrikerEssenceSpent: number;
    autoStrikerBankedEssenceDelta: number;
    autoStrikerOverclockEnabled: boolean;
    autoStrikerOverclockBankGains: number;
    autoStrikerOverclockBustLosses: number;
    autoStrikerSurgeHeatAdded: number;
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
    /** hazard-free world model: only explicit surge bust loss is represented. */
    hazardModel: "surge-bust-only";
    samples: StormBotSample[];
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

/** reject invalid or out-of-run sample marks and return a sorted unique copy. */
function validateSampleMinutes(
    minutes: readonly number[],
    durationSec: number
): number[] {
    for (const minute of minutes) {
        if (
            !(minute > 0) ||
            !Number.isFinite(minute) ||
            minute * 60 > durationSec + 1e-9
        ) {
            throw new Error("sampleAtMinutes must contain finite positive marks within durationSec");
        }
    }
    return [...new Set(minutes)].sort((a, b) => a - b);
}

/** select the middle observation from an odd deterministic seed sweep. */
function median(values: number[]): number {
    if (values.length === 0 || values.length % 2 === 0) {
        throw new Error("late pacing requires a non-empty odd seed count");
    }
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[sorted.length >> 1];
}

/** find one required late-arc sample, failing loudly instead of dropping a run. */
function requiredSample(summary: StormBotSummary, minute: number): StormBotSample {
    const sample = summary.samples.find((candidate) => candidate.minute === minute);
    if (!sample) throw new Error(`missing ${minute}m sample for seed ${summary.seed}`);
    return sample;
}

/** reduce an odd seed sweep to the authoritative median trajectory and band result. */
export function summarizeLatePacing(summaries: StormBotSummary[]): LatePacingReport {
    const samples = LATE_PACING_SAMPLE_MINUTES.map((minute) => ({
        minute,
        cumulativeEssence: median(
            summaries.map((summary) => requiredSample(summary, minute).cumulativeEssence)
        ),
        coresPerMin: median(
            summaries.map((summary) => requiredSample(summary, minute).coresPerMin)
        ),
    }));
    const at = (minute: number): LatePacingMedianSample => {
        const sample = samples.find((candidate) => candidate.minute === minute);
        if (!sample) throw new Error(`missing median ${minute}m sample`);
        return sample;
    };
    const essenceGrowth20To30 = at(30).cumulativeEssence / at(20).cumulativeEssence;
    const essenceGrowth25To35 = at(35).cumulativeEssence / at(25).cumulativeEssence;
    const coarseCoresPerMinGrowth = LATE_PACING_COARSE_MINUTES.slice(1).map(
        (minute, index) =>
            at(minute).coresPerMin / at(LATE_PACING_COARSE_MINUTES[index]).coresPerMin - 1
    );
    const coresPerMin35Over30Growth = at(35).coresPerMin / at(30).coresPerMin - 1;
    const growthInBand = (growth: number): boolean =>
        growth >= LATE_PACING_TARGETS.minimumEssenceGrowth &&
        growth <= LATE_PACING_TARGETS.maximumEssenceGrowth;
    const passes =
        growthInBand(essenceGrowth20To30) &&
        growthInBand(essenceGrowth25To35) &&
        coarseCoresPerMinGrowth.every(
            (growth) => growth >= LATE_PACING_TARGETS.minimumCoarseCoresPerMinGrowth
        ) &&
        coresPerMin35Over30Growth >=
            LATE_PACING_TARGETS.minimumThirtyFiveOverThirtyCoresPerMinGrowth;
    return {
        trials: summaries.length,
        samples,
        essenceGrowth20To30,
        essenceGrowth25To35,
        coarseCoresPerMinGrowth,
        coresPerMin35Over30Growth,
        passes,
    };
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
    const sampleMinutes = validateSampleMinutes(config.sampleAtMinutes ?? [], config.durationSec);

    const economy = createState();
    const stone = brushById("stone");
    const brushCost = fullStrokeCost(stone);
    const brushSim = createBrushSimulation(config.physicsSeed ?? (config.seed ^ 0x6754_22a1));
    const combatRng = mulberry32((config.seed ^ 0x1a2b_3c4d) | 0);
    const surgeRng = mulberry32((config.seed ^ 0x5e6f_7a8b) | 0);
    const autoStriker = createAutoStrikerState();

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
    let firstAutoStrikerAtSec: number | null = null;
    let automaticAttacks = 0;
    let automaticRoutedAttacks = 0;
    let automaticCapturedAttacks = 0;
    let autoStrikerEssenceSpent = 0;
    let autoStrikerBankedEssenceDelta = 0;
    let autoStrikerOverclockBankGains = 0;
    let autoStrikerOverclockBustLosses = 0;
    let autoStrikerSurgeHeatAdded = 0;
    let routedValue = 0;
    let bankedPotValue = 0;
    let bustedPotValue = 0;
    let brushPending = false;
    let rawCollectedValue = 0;
    let collectorFeeValue = 0;
    let lostValue = 0;
    const collectionQueue: Array<{ value: number; collectAtSec: number }> = [];
    let collectionHead = 0;
    const samples: StormBotSample[] = [];
    let nextSample = 0;

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
        while (
            collectionQueue[collectionHead] &&
            collectionQueue[collectionHead].collectAtSec <= timeSec + 1e-9
        ) {
            const route = collectionQueue[collectionHead];
            collectionHead += 1;
            rawCollectedValue += route.value;
            const credited = valueToEssence(route.value, COLLECTOR_BASE_FEE);
            collectorFeeValue += route.value - credited;
            creditEssence(economy, credited);
        }
    };

    /** route a completed surge exactly once: banked pots collect, busted pots are lost. */
    const settlePot = (reason: "bank" | "bust", pot: PotState): void => {
        if (profile.allowAutoStrikerOverclock) {
            const stacksBefore = autoStriker.overclockStacks;
            settleAutoStrikerOverclock(autoStriker, reason, pot);
            const stackDelta = autoStriker.overclockStacks - stacksBefore;
            if (stackDelta > 0) autoStrikerOverclockBankGains += stackDelta;
            else if (stackDelta < 0) autoStrikerOverclockBustLosses -= stackDelta;
        }
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

    /** record every due long-arc mark from cumulative collected essence. */
    const recordSamples = (timeSec: number): void => {
        while (
            nextSample < sampleMinutes.length &&
            sampleMinutes[nextSample] * 60 <= timeSec + 1e-9
        ) {
            const minute = sampleMinutes[nextSample];
            const cores = coresFromEssence(economy.bankedEssence);
            samples.push({
                minute,
                cumulativeEssence: economy.bankedEssence,
                cores,
                coresPerMin: cores / minute,
                autoStrikerLevel: autoStriker.level,
                autoStrikerOverclockStacks: autoStriker.overclockStacks,
            });
            nextSample += 1;
        }
    };

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

    /** expected manual-plus-turret damage rate for purchase comparisons. */
    const progressionDps = (): number => {
        const automaticRate = autoStriker.level > 0 ? 1 / autoStrikerInterval(autoStriker) : 0;
        return expectedDamagePerAttack(economy) *
            (profile.manualClicksPerSec + automaticRate);
    };

    /** return the affordable economy upgrade with the best marginal dps per essence. */
    const bestEconomyUpgrade = (): { id: UpgradeId; ratio: number } | null => {
        const before = progressionDps();
        let best: { id: UpgradeId; ratio: number } | null = null;
        for (const upgrade of UPGRADES) {
            if (!canBuy(economy, upgrade.id)) continue;
            const cost = upgradeCost(economy, upgrade.id);
            economy.levels[upgrade.id] += 1;
            const ratio = (progressionDps() - before) / cost;
            economy.levels[upgrade.id] -= 1;
            if (!best || ratio > best.ratio) best = { id: upgrade.id, ratio };
        }
        return best;
    };

    /** charge one turret purchase or upgrade while proving cumulative essence is untouched. */
    const buyAutoStrikerUpgrade = (): boolean => {
        const spendableBefore = economy.essence;
        const bankedBefore = economy.bankedEssence;
        const bought =
            autoStriker.level === 0
                ? placeAutoStriker(brushSim, economy, autoStriker, 5, 5)
                : upgradeAutoStriker(economy, autoStriker);
        if (!bought) return false;
        autoStrikerEssenceSpent += spendableBefore - economy.essence;
        autoStrikerBankedEssenceDelta += economy.bankedEssence - bankedBefore;
        if (firstAutoStrikerAtSec === null) firstAutoStrikerAtSec = economy.elapsed;
        return true;
    };

    /** buy at most one competent progression upgrade after a pointer action. */
    const buyDpsUpgrade = (): void => {
        if (brushPending || !profile.buyDpsUpgrades) return;
        // Preserve the measured first-defense behavior before handing spending to
        // automation. Both sides of the ablation use the same brush-first policy.
        if (!profile.allowAutoStriker || firstBrushPaintedAtSec === null) {
            const upgrade = greedyBuy(economy);
            if (upgrade) buy(economy, upgrade);
            return;
        }
        if (autoStriker.level === 0) {
            if (canUpgradeAutoStriker(economy, autoStriker)) buyAutoStrikerUpgrade();
            return;
        }

        const bestEconomy = bestEconomyUpgrade();
        let autoRatio = -1;
        if (canUpgradeAutoStriker(economy, autoStriker)) {
            const before = progressionDps();
            const cost = autoStrikerUpgradeCost(autoStriker);
            autoStriker.level += 1;
            autoRatio = (progressionDps() - before) / cost;
            autoStriker.level -= 1;
        }
        if (autoRatio > (bestEconomy?.ratio ?? -1)) buyAutoStrikerUpgrade();
        else if (bestEconomy) buy(economy, bestEconomy.id);
    };

    /** let the strategy bank a live pot after either input or automatic strikes. */
    const decideBank = (): void => {
        const action = strategy.decide(strategyView(economy.elapsed, economy, surge));
        if (action.type === "bank" && surge.active) surge.endSurge("bank");
    };

    /** route one strike through shared attack, surge, collection, and source ledgers. */
    const runStrike = (source: "manual" | "automatic", heat?: number): void => {
        attacks += 1;
        const capturedAutoCoreHeat =
            source === "automatic" && profile.allowAutoStrikerOverclock
                ? autoStrikerSurgeHeat(autoStriker)
                : 0;
        const coreTempBefore = surge.coreTemp;
        executeStrike(
            economy,
            surge,
            combatRng,
            {
                onSurgeStart: () => undefined,
                onStrike: (result, captured) => {
                    if (captured) {
                        capturedAttacks += 1;
                        if (source === "automatic") automaticCapturedAttacks += 1;
                        return;
                    }
                    routedAttacks += 1;
                    routedValue += result.damage;
                    if (source === "automatic") automaticRoutedAttacks += 1;
                    queueCollection(result.damage);
                },
            },
            undefined,
            heat,
            source,
            capturedAutoCoreHeat
        );
        if (source === "automatic" && surge.coreTemp > coreTempBefore) {
            autoStrikerSurgeHeatAdded += Math.min(
                capturedAutoCoreHeat,
                surge.coreTemp - coreTempBefore
            );
        }
        decideBank();
    };

    /** advance heat and collection clocks to an exact scheduled time. */
    const advanceTo = (timeSec: number): void => {
        const dt = timeSec - economy.elapsed;
        if (!(dt > 0)) return;
        economy.elapsed = timeSec;
        tickAutoStriker(autoStriker, dt, () => {
            automaticAttacks += 1;
            runStrike("automatic", autoStrikerStrikeHeat(autoStriker));
        });
        surge.decayHeat(HEAT_DECAY_PER_SEC * dt);
        surge.tickHeat(dt);
        collectDue(timeSec);
        reserveBrush();
        recordSamples(timeSec);
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
            runStrike("manual");
            reserveBrush();
            buyDpsUpgrade();
        }
        advanceTo(frameEnd);
    }

    const stormEnd = endStorm(economy, "blow-up");
    const livePotValue = surge.active ? surge.pot.value : 0;
    const pendingValue =
        collectionQueue
            .slice(collectionHead)
            .reduce((total, route) => total + route.value, 0) + livePotValue;
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
        firstAutoStrikerAtSec,
        automaticAttacks,
        automaticRoutedAttacks,
        automaticCapturedAttacks,
        autoStrikerLevel: autoStriker.level,
        autoStrikerOverclockStacks: autoStriker.overclockStacks,
        autoStrikerEssenceSpent,
        autoStrikerBankedEssenceDelta,
        autoStrikerOverclockEnabled: profile.allowAutoStrikerOverclock,
        autoStrikerOverclockBankGains,
        autoStrikerOverclockBustLosses,
        autoStrikerSurgeHeatAdded,
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
        hazardModel: "surge-bust-only",
        samples,
    };
}
