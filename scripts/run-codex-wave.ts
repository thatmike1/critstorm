import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createCodexWaveRuntime } from "./codex-wave-runtime";
import {
    runWave,
    validateWaveDefinition,
    isRecord,
    type DependencyCheck,
    type WaveDefinition,
    type WaveModel,
    type WaveTask,
} from "./codex-wave-runner";

/** narrows a model configuration from a dynamic wave module */
function isWaveModel(value: unknown): value is WaveModel {
    return (
        isRecord(value) &&
        typeof value.id === "string" &&
        (value.effort === "low" ||
            value.effort === "medium" ||
            value.effort === "high" ||
            value.effort === "xhigh")
    );
}

/** narrows a task from a dynamic wave module */
function isWaveTask(value: unknown): value is WaveTask {
    return (
        isRecord(value) &&
        typeof value.id === "string" &&
        typeof value.branch === "string" &&
        typeof value.title === "string" &&
        typeof value.commitMessage === "string" &&
        typeof value.spec === "string" &&
        (value.collisionFiles === undefined ||
            (Array.isArray(value.collisionFiles) &&
                value.collisionFiles.every((file) => typeof file === "string")))
    );
}

/** narrows a dependency check from a dynamic wave module */
function isDependencyCheck(value: unknown): value is DependencyCheck {
    return (
        isRecord(value) &&
        typeof value.path === "string" &&
        typeof value.pattern === "string" &&
        typeof value.description === "string"
    );
}

/** narrows a dynamically imported default export to a complete wave definition */
function isWaveDefinition(value: unknown): value is WaveDefinition {
    if (!isRecord(value) || !isRecord(value.models)) return false;
    return (
        typeof value.name === "string" &&
        typeof value.repo === "string" &&
        typeof value.baseBranch === "string" &&
        isWaveModel(value.models.implement) &&
        isWaveModel(value.models.review) &&
        isWaveModel(value.models.fix) &&
        Array.isArray(value.qualityGate) &&
        value.qualityGate.every((command) => typeof command === "string") &&
        Array.isArray(value.dependencyChecks) &&
        value.dependencyChecks.every(isDependencyCheck) &&
        typeof value.maxConcurrency === "number" &&
        Array.isArray(value.mergeOrder) &&
        value.mergeOrder.every((id) => typeof id === "string") &&
        Array.isArray(value.tasks) &&
        value.tasks.every(isWaveTask)
    );
}

/** reads the default export from a TypeScript wave definition */
async function loadDefinition(definitionPath: string): Promise<WaveDefinition> {
    const imported: unknown = await import(pathToFileURL(path.resolve(definitionPath)).href);
    if (!isRecord(imported) || !isWaveDefinition(imported.default)) {
        throw new Error(`${definitionPath} does not default-export a valid wave definition`);
    }
    validateWaveDefinition(imported.default);
    return imported.default;
}

/** reads a named CLI option value */
function optionValue(args: readonly string[], option: string): string | null {
    const index = args.indexOf(option);
    if (index < 0) return null;
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
        throw new Error(`${option} requires a value`);
    }
    return value;
}

/** validates input, requires an explicit green light, and runs one wave */
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const definitionPath = args[0];
    if (definitionPath === undefined || definitionPath.startsWith("--")) {
        throw new Error("usage: run-codex-wave <definition> [--check] [--green-lit <wave>]");
    }

    const definition = await loadDefinition(definitionPath);
    if (args.includes("--check")) {
        process.stdout.write(
            `${definition.name}: valid definition with ${String(definition.tasks.length)} tasks\n`,
        );
        return;
    }

    const greenLight = optionValue(args, "--green-lit");
    if (greenLight !== definition.name) {
        throw new Error(
            `refusing to start ${definition.name} without --green-lit ${definition.name}`,
        );
    }

    const manifest = await runWave(definition, createCodexWaveRuntime());
    const manifestPath = path.join(tmpdir(), `${definition.name}-manifest.json`);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    process.stdout.write(`\nmanifest: ${manifestPath}\n`);
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    if (manifest.status !== "ready-to-integrate") process.exitCode = 2;
}

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
