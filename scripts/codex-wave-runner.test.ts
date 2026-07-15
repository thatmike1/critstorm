import { describe, expect, it, vi } from "vitest";
import {
    runWave,
    validateWaveDefinition,
    type GuardResult,
    type ReviewResult,
    type WaveDefinition,
    type WaveRuntime,
} from "./codex-wave-runner";

const WAVE: WaveDefinition = {
    name: "test-wave",
    repo: "/repo",
    baseBranch: "main",
    models: {
        implement: { id: "implement-model", effort: "high" },
        review: { id: "review-model", effort: "high" },
        fix: { id: "fix-model", effort: "high" },
    },
    qualityGate: ["test", "typecheck"],
    dependencyChecks: [],
    maxConcurrency: 2,
    mergeOrder: ["task-a", "task-b"],
    tasks: [
        {
            id: "task-a",
            branch: "wave/task-a",
            title: "task a",
            commitMessage: "feat: task a",
            spec: "the exact task a spec",
        },
        {
            id: "task-b",
            branch: "wave/task-b",
            title: "task b",
            commitMessage: "feat: task b",
            spec: "the exact task b spec",
        },
    ],
};

/** creates a runtime whose phase calls can be inspected by a test */
function createRuntime(
    guard: GuardResult,
    reviews: Readonly<Record<string, ReviewResult>> = {},
): WaveRuntime {
    return {
        guard: vi.fn().mockResolvedValue(guard),
        implement: vi.fn().mockImplementation(async (task) => ({
            branch: task.branch,
            changedFiles: [`${task.id}.ts`],
            prNumber: task.id === "task-a" ? 101 : 102,
        })),
        review: vi.fn().mockImplementation(async (task) =>
            reviews[task.id] ?? { findings: [], verdict: "clean" },
        ),
        fix: vi.fn().mockResolvedValue({ fixed: ["confirmed"], rejected: [] }),
    };
}

describe("runWave", () => {
    it("aborts without spending implementation work when the guard fails", async () => {
        const runtime = createRuntime({
            ok: false,
            baseSha: "",
            failures: ["main is behind origin/main"],
        });

        const result = await runWave(WAVE, runtime);

        expect(result).toEqual({
            wave: "test-wave",
            status: "aborted",
            baseSha: "",
            failures: ["main is behind origin/main"],
            tasks: [],
            mergeOrder: WAVE.mergeOrder,
        });
        expect(runtime.implement).not.toHaveBeenCalled();
        expect(runtime.review).not.toHaveBeenCalled();
        expect(runtime.fix).not.toHaveBeenCalled();
    });

    it("runs each task through implementation and independent review with its exact spec", async () => {
        const runtime = createRuntime({
            ok: true,
            baseSha: "abc123",
            failures: [],
        });

        const result = await runWave(WAVE, runtime);

        expect(result.status).toBe("ready-to-integrate");
        expect(result.tasks).toHaveLength(2);
        expect(runtime.implement).toHaveBeenCalledTimes(2);
        expect(runtime.review).toHaveBeenCalledWith(
            expect.objectContaining({ id: "task-a", spec: "the exact task a spec" }),
            expect.objectContaining({ prNumber: 101 }),
            WAVE,
            "abc123",
        );
        expect(runtime.fix).not.toHaveBeenCalled();
    });

    it("fixes only confirmed non-minor review findings", async () => {
        const runtime = createRuntime(
            { ok: true, baseSha: "abc123", failures: [] },
            {
                "task-a": {
                    verdict: "needs-fix",
                    findings: [
                        {
                            file: "a.ts",
                            line: 4,
                            class: "minor",
                            summary: "small naming issue",
                        },
                        {
                            file: "a.ts",
                            line: 8,
                            class: "major",
                            summary: "contract is not implemented",
                        },
                    ],
                },
            },
        );

        const result = await runWave(WAVE, runtime);

        expect(runtime.fix).toHaveBeenCalledTimes(1);
        expect(runtime.fix).toHaveBeenCalledWith(
            expect.objectContaining({ id: "task-a" }),
            [expect.objectContaining({ class: "major" })],
            WAVE,
        );
        expect(result.tasks[0]?.nonMinorFindings).toBe(1);
        expect(result.tasks[0]?.fix).toEqual({
            fixed: ["confirmed"],
            rejected: [],
        });
    });

    it("finishes independent pipelines and returns a failed manifest when one task dies", async () => {
        const runtime = createRuntime({
            ok: true,
            baseSha: "abc123",
            failures: [],
        });
        vi.mocked(runtime.implement).mockImplementation(async (task) => {
            if (task.id === "task-a") throw new Error("agent timed out");
            return { branch: task.branch, changedFiles: ["b.ts"], prNumber: 102 };
        });

        const result = await runWave(WAVE, runtime);

        expect(result.status).toBe("failed");
        expect(result.failures).toEqual(["task-a: agent timed out"]);
        expect(result.tasks.map((task) => task.id)).toEqual(["task-b"]);
    });
});

describe("validateWaveDefinition", () => {
    it("rejects a merge order that does not contain every task exactly once", () => {
        expect(() =>
            validateWaveDefinition({ ...WAVE, mergeOrder: ["task-a", "task-a"] }),
        ).toThrow("mergeOrder must contain every task id exactly once");
    });
});
