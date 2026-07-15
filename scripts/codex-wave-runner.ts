export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export interface WaveModel {
    readonly id: string;
    readonly effort: ReasoningEffort;
}

export interface DependencyCheck {
    readonly path: string;
    readonly pattern: string;
    readonly description: string;
}

export interface WaveTask {
    readonly id: string;
    readonly branch: string;
    readonly title: string;
    readonly commitMessage: string;
    readonly spec: string;
    readonly collisionFiles?: readonly string[];
}

export interface WaveDefinition {
    readonly name: string;
    readonly repo: string;
    readonly baseBranch: string;
    readonly models: {
        readonly implement: WaveModel;
        readonly review: WaveModel;
        readonly fix: WaveModel;
    };
    readonly qualityGate: readonly string[];
    readonly dependencyChecks: readonly DependencyCheck[];
    readonly maxConcurrency: number;
    readonly mergeOrder: readonly string[];
    readonly tasks: readonly WaveTask[];
}

export interface GuardResult {
    readonly ok: boolean;
    readonly baseSha: string;
    readonly failures: readonly string[];
}

export interface ImplementationResult {
    readonly branch: string;
    readonly changedFiles: readonly string[];
    readonly prNumber: number;
}

export interface ReviewFinding {
    readonly id: string;
    readonly file: string;
    readonly line?: number;
    readonly class: "blocker" | "major" | "minor";
    readonly summary: string;
}

export interface ReviewResult {
    readonly findings: readonly ReviewFinding[];
    readonly verdict: "clean" | "needs-fix";
}

export interface FindingDisposition {
    readonly findingId: string;
    readonly summary: string;
}

export interface FixResult {
    readonly fixed: readonly FindingDisposition[];
    readonly rejected: readonly FindingDisposition[];
}

/** narrows an unknown value to a string-keyed object */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface WaveRuntime {
    /** checks all preconditions without changing repository state */
    guard(definition: WaveDefinition): Promise<GuardResult>;
    /** implements one task and opens its pull request */
    implement(
        task: WaveTask,
        definition: WaveDefinition,
        baseSha: string,
    ): Promise<ImplementationResult>;
    /** independently reviews an implementation against its task contract */
    review(
        task: WaveTask,
        implementation: ImplementationResult,
        definition: WaveDefinition,
        baseSha: string,
    ): Promise<ReviewResult>;
    /** verifies and addresses confirmed non-minor findings */
    fix(
        task: WaveTask,
        findings: readonly ReviewFinding[],
        definition: WaveDefinition,
    ): Promise<FixResult>;
    /** removes temporary state after a task pipeline completes successfully */
    finish?(task: WaveTask, definition: WaveDefinition): Promise<void>;
}

export interface WaveTaskResult {
    readonly id: string;
    readonly branch: string;
    readonly prNumber: number;
    readonly changedFiles: readonly string[];
    readonly verdict: ReviewResult["verdict"];
    readonly findings: readonly ReviewFinding[];
    readonly nonMinorFindings: number;
    readonly fix: FixResult | null;
}

export interface WaveManifest {
    readonly wave: string;
    readonly status: "aborted" | "failed" | "ready-to-integrate";
    readonly baseSha: string;
    readonly failures: readonly string[];
    readonly tasks: readonly WaveTaskResult[];
    readonly mergeOrder: readonly string[];
}

type TaskPipelineResult =
    | { readonly ok: true; readonly result: WaveTaskResult }
    | { readonly ok: false; readonly failure: string };

/** validates invariants the runner relies on before it touches repository state */
export function validateWaveDefinition(definition: WaveDefinition): void {
    if (!Number.isInteger(definition.maxConcurrency) || definition.maxConcurrency < 1) {
        throw new Error("maxConcurrency must be a positive integer");
    }
    if (definition.tasks.length === 0) {
        throw new Error("a wave must contain at least one task");
    }

    const taskIds = definition.tasks.map((task) => task.id);
    const branches = definition.tasks.map((task) => task.branch);
    if (new Set(taskIds).size !== taskIds.length) {
        throw new Error("task ids must be unique");
    }
    if (new Set(branches).size !== branches.length) {
        throw new Error("task branches must be unique");
    }

    const orderedIds = [...definition.mergeOrder].sort();
    const expectedIds = [...taskIds].sort();
    if (
        orderedIds.length !== expectedIds.length ||
        orderedIds.some((id, index) => id !== expectedIds[index])
    ) {
        throw new Error("mergeOrder must contain every task id exactly once");
    }

    for (const task of definition.tasks) {
        if (!/^(feat|fix|refactor|chore): [a-z0-9]/u.test(task.commitMessage)) {
            throw new Error(`invalid commit message for ${task.id}`);
        }
        if (task.spec.trim().length === 0) {
            throw new Error(`task spec is empty for ${task.id}`);
        }
    }
}

/** maps work with a fixed concurrency ceiling while preserving input order */
async function mapWithConcurrency<Input, Output>(
    inputs: readonly Input[],
    concurrency: number,
    worker: (input: Input) => Promise<Output>,
): Promise<Output[]> {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
        throw new Error("maxConcurrency must be a positive integer");
    }

    const outputs = new Array<Output>(inputs.length);
    let nextIndex = 0;

    /** drains input indices until no work remains */
    async function drain(): Promise<void> {
        while (nextIndex < inputs.length) {
            const index = nextIndex;
            nextIndex += 1;
            const input = inputs[index];
            if (input !== undefined) {
                outputs[index] = await worker(input);
            }
        }
    }

    const workerCount = Math.min(concurrency, inputs.length);
    await Promise.all(Array.from({ length: workerCount }, () => drain()));
    return outputs;
}

/** executes guard and task pipelines, stopping before orchestrator integration */
export async function runWave(
    definition: WaveDefinition,
    runtime: WaveRuntime,
): Promise<WaveManifest> {
    validateWaveDefinition(definition);
    const guard = await runtime.guard(definition);
    if (!guard.ok) {
        return {
            wave: definition.name,
            status: "aborted",
            baseSha: guard.baseSha,
            failures: guard.failures,
            tasks: [],
            mergeOrder: definition.mergeOrder,
        };
    }

    const pipelines = await mapWithConcurrency(
        definition.tasks,
        definition.maxConcurrency,
        async (task): Promise<TaskPipelineResult> => {
            try {
                const implementation = await runtime.implement(
                    task,
                    definition,
                    guard.baseSha,
                );
                const review = await runtime.review(
                    task,
                    implementation,
                    definition,
                    guard.baseSha,
                );
                const nonMinorFindings = review.findings.filter(
                    (finding) => finding.class !== "minor",
                );
                const fix =
                    nonMinorFindings.length > 0
                        ? await runtime.fix(task, nonMinorFindings, definition)
                        : null;

                await runtime.finish?.(task, definition);

                return {
                    ok: true,
                    result: {
                        id: task.id,
                        branch: implementation.branch,
                        prNumber: implementation.prNumber,
                        changedFiles: implementation.changedFiles,
                        verdict: review.verdict,
                        findings: review.findings,
                        nonMinorFindings: nonMinorFindings.length,
                        fix,
                    },
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return { ok: false, failure: `${task.id}: ${message}` };
            }
        },
    );

    const tasks = pipelines
        .filter((pipeline): pipeline is Extract<TaskPipelineResult, { ok: true }> => pipeline.ok)
        .map((pipeline) => pipeline.result);
    const failures = pipelines
        .filter((pipeline): pipeline is Extract<TaskPipelineResult, { ok: false }> => !pipeline.ok)
        .map((pipeline) => pipeline.failure);

    return {
        wave: definition.name,
        status: failures.length === 0 ? "ready-to-integrate" : "failed",
        baseSha: guard.baseSha,
        failures,
        tasks,
        mergeOrder: definition.mergeOrder,
    };
}
