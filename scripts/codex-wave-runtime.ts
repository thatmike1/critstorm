import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isRecord } from "./codex-wave-runner";
import type {
    FixResult,
    GuardResult,
    ImplementationResult,
    ReviewFinding,
    ReviewResult,
    WaveDefinition,
    WaveModel,
    WaveRuntime,
    WaveTask,
} from "./codex-wave-runner";

interface CommandResult {
    readonly stdout: string;
    readonly stderr: string;
}

interface TaskWorkspace {
    readonly path: string;
    readonly prNumber: number | null;
}

interface ImplementationAgentResult {
    readonly summary: string;
}

interface WorktreeChanges {
    readonly all: readonly string[];
    readonly untracked: readonly string[];
}

const IMPLEMENTATION_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        summary: { type: "string" },
    },
    required: ["summary"],
} as const;

const REVIEW_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        findings: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    id: { type: "string" },
                    file: { type: "string" },
                    line: { type: "integer" },
                    class: {
                        type: "string",
                        enum: ["blocker", "major", "minor"],
                    },
                    summary: { type: "string" },
                },
                required: ["id", "file", "class", "summary"],
            },
        },
        verdict: { type: "string", enum: ["clean", "needs-fix"] },
    },
    required: ["findings", "verdict"],
} as const;

const FIX_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        fixed: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    findingId: { type: "string" },
                    summary: { type: "string" },
                },
                required: ["findingId", "summary"],
            },
        },
        rejected: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    findingId: { type: "string" },
                    summary: { type: "string" },
                },
                required: ["findingId", "summary"],
            },
        },
    },
    required: ["fixed", "rejected"],
} as const;

/** executes one process without passing command text through a shell */
async function runCommand(
    command: string,
    args: readonly string[],
    cwd: string,
    stdin?: string,
    timeoutMs?: number,
): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            env: process.env,
            stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        const timeout =
            timeoutMs === undefined
                ? undefined
                : setTimeout(() => {
                      child.kill("SIGTERM");
                  }, timeoutMs);

        const childStdout = child.stdout;
        const childStderr = child.stderr;
        if (childStdout === null || childStderr === null) {
            reject(new Error(`failed to capture output from ${command}`));
            return;
        }
        childStdout.setEncoding("utf8");
        childStderr.setEncoding("utf8");
        childStdout.on("data", (chunk: string) => {
            stdout += chunk;
            process.stdout.write(chunk);
        });
        childStderr.on("data", (chunk: string) => {
            stderr += chunk;
            process.stderr.write(chunk);
        });
        child.on("error", reject);
        child.on("close", (code) => {
            if (timeout !== undefined) clearTimeout(timeout);
            if (code === 0) {
                resolve({ stdout, stderr });
                return;
            }
            reject(
                new Error(
                    `${command} ${args.join(" ")} failed with exit ${String(code)} in ${cwd}\n${stderr}`,
                ),
            );
        });

        if (stdin !== undefined) {
            const childStdin = child.stdin;
            if (childStdin === null) {
                reject(new Error(`failed to open stdin for ${command}`));
                return;
            }
            childStdin.write(stdin);
            childStdin.end();
        }
    });
}

/** executes a trusted repository command through bash */
async function runShell(command: string, cwd: string): Promise<CommandResult> {
    return runCommand("/bin/bash", ["-lc", command], cwd);
}

/** reports a command failure as text instead of throwing */
async function commandFailure(
    command: string,
    args: readonly string[],
    cwd: string,
): Promise<string | null> {
    try {
        await runCommand(command, args, cwd);
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

/** parses a structured implementation response */
function parseImplementationResult(value: unknown): ImplementationAgentResult {
    if (!isRecord(value) || typeof value.summary !== "string") {
        throw new Error("implementation agent returned an invalid result");
    }
    return { summary: value.summary };
}

/** narrows one parsed review finding */
function parseReviewFinding(value: unknown): ReviewFinding {
    if (
        !isRecord(value) ||
        typeof value.id !== "string" ||
        typeof value.file !== "string" ||
        typeof value.summary !== "string" ||
        (value.class !== "blocker" &&
            value.class !== "major" &&
            value.class !== "minor") ||
        (value.line !== undefined &&
            (!Number.isInteger(value.line) || typeof value.line !== "number"))
    ) {
        throw new Error("review agent returned an invalid finding");
    }
    return {
        id: value.id,
        file: value.file,
        line: typeof value.line === "number" ? value.line : undefined,
        class: value.class,
        summary: value.summary,
    };
}

/** parses a structured review response */
function parseReviewResult(value: unknown): ReviewResult {
    if (
        !isRecord(value) ||
        !Array.isArray(value.findings) ||
        (value.verdict !== "clean" && value.verdict !== "needs-fix")
    ) {
        throw new Error("review agent returned an invalid result");
    }
    const findings = value.findings.map(parseReviewFinding);
    if (new Set(findings.map((finding) => finding.id)).size !== findings.length) {
        throw new Error("review agent returned duplicate finding ids");
    }
    return { findings, verdict: value.verdict };
}

/** parses one fix disposition */
function parseFindingDisposition(value: unknown): {
    findingId: string;
    summary: string;
} {
    if (
        !isRecord(value) ||
        typeof value.findingId !== "string" ||
        typeof value.summary !== "string"
    ) {
        throw new Error("fix agent returned an invalid disposition");
    }
    return { findingId: value.findingId, summary: value.summary };
}

/** parses a structured fix response */
function parseFixResult(value: unknown): FixResult {
    if (
        !isRecord(value) ||
        !Array.isArray(value.fixed) ||
        !Array.isArray(value.rejected)
    ) {
        throw new Error("fix agent returned an invalid result");
    }
    return {
        fixed: value.fixed.map(parseFindingDisposition),
        rejected: value.rejected.map(parseFindingDisposition),
    };
}

/** runs one isolated Codex worker and returns its structured final response */
async function runCodexAgent(
    cwd: string,
    model: WaveModel,
    sandbox: "read-only" | "workspace-write",
    prompt: string,
    schema: object,
): Promise<unknown> {
    const outputDirectory = await mkdtemp(path.join(tmpdir(), "critstorm-codex-agent-"));
    const schemaPath = path.join(outputDirectory, "schema.json");
    const outputPath = path.join(outputDirectory, "result.json");
    await writeFile(schemaPath, JSON.stringify(schema), "utf8");

    try {
        await runCommand(
            "codex",
            [
                "-a",
                "never",
                "exec",
                "--ephemeral",
                "--disable",
                "multi_agent",
                "--model",
                model.id,
                "--config",
                `model_reasoning_effort=${JSON.stringify(model.effort)}`,
                "--sandbox",
                sandbox,
                "--cd",
                cwd,
                "--output-schema",
                schemaPath,
                "--output-last-message",
                outputPath,
                "-",
            ],
            cwd,
            prompt,
            30 * 60 * 1_000,
        );

        const output = await readFile(outputPath, "utf8");
        const parsed: unknown = JSON.parse(output);
        return parsed;
    } finally {
        await rm(outputDirectory, { recursive: true, force: true });
    }
}

/** returns tracked and untracked paths changed in a worktree */
async function changedFiles(worktree: string): Promise<WorktreeChanges> {
    const tracked = await runCommand(
        "git",
        ["diff", "--name-only", "--relative", "HEAD"],
        worktree,
    );
    const untracked = await runCommand(
        "git",
        ["ls-files", "--others", "--exclude-standard"],
        worktree,
    );
    const untrackedFiles = untracked.stdout
        .split("\n")
        .map((file) => file.trim())
        .filter((file) => file.length > 0);
    const all = [...new Set([...tracked.stdout.split("\n"), ...untrackedFiles])]
        .map((file) => file.trim())
        .filter((file) => file.length > 0)
        .sort();
    return { all, untracked: untrackedFiles.sort() };
}

/** rejects note-like markdown artifacts before the runner stages a worker diff */
function assertNoUntrackedMarkdown(files: readonly string[]): void {
    const markdown = files.filter((file) => file.endsWith(".md"));
    if (markdown.length > 0) {
        throw new Error(
            `worker created markdown files that the runner will not commit: ${markdown.join(", ")}`,
        );
    }
}

/** runs every configured quality-gate command in order */
async function runQualityGate(definition: WaveDefinition, cwd: string): Promise<void> {
    for (const command of definition.qualityGate) {
        await runShell(command, cwd);
    }
}

/** checks that the worker did not bypass runner-owned Git operations */
async function assertHeadUnchanged(worktree: string, expectedSha: string): Promise<void> {
    const head = await runCommand("git", ["rev-parse", "HEAD"], worktree);
    if (head.stdout.trim() !== expectedSha) {
        throw new Error("worker changed Git history; commits are runner-owned");
    }
}

/** formats a comment-only GitHub review body */
function reviewBody(task: WaveTask, review: ReviewResult): string {
    if (review.findings.length === 0) {
        return `Codex wave review for ${task.id}: clean against the task spec.`;
    }
    const findings = review.findings.map((finding) => {
        const location = `${finding.file}${finding.line === undefined ? "" : `:${finding.line}`}`;
        return `- **${finding.class}** ${finding.id} ${location} — ${finding.summary}`;
    });
    return [`Codex wave review for ${task.id}:`, "", ...findings].join("\n");
}

/** extracts the pull-request number printed by gh pr create */
function parsePrNumber(output: string): number {
    const match = output.match(/\/pull\/(\d+)/u);
    if (match?.[1] === undefined) {
        throw new Error(`could not parse pull-request number from: ${output}`);
    }
    return Number(match[1]);
}

/** builds the implementation prompt while keeping the task spec verbatim */
function implementationPrompt(task: WaveTask): string {
    return `You are the implementation worker for beads issue ${task.id} (${task.title}).

You are already inside an isolated worktree on branch ${task.branch}. Read AGENTS.md and all design/module references named in the task spec before editing.

TASK SPEC — this exact text is also the review contract:
${task.spec}

Implement only this task. Run focused checks while working, but the runner owns the final quality gate. Do not commit, push, open or merge a PR, run bd, approve a review, or spawn subagents. The runner owns all Git, GitHub, and issue-tracker mutations.

Return a concise JSON summary of what you implemented.`;
}

/** builds the independent review prompt with the unchanged task spec */
function reviewerPrompt(
    task: WaveTask,
    implementation: ImplementationResult,
    baseSha: string,
): string {
    return `You are the independent reviewer for PR #${implementation.prNumber}, branch ${implementation.branch}, beads issue ${task.id} (${task.title}). Work read-only from the main checkout.

Inspect the complete local diff with git diff ${baseSha}...${implementation.branch} and read the relevant design.md sections and existing modules. Review against scope discipline, test quality, repo conventions, value conservation, and the identity guardrail where relevant.

TASK SPEC — identical to the implementer's contract:
${task.spec}

Return structured findings with stable unique IDs (F1, F2, ...), exact file and line references, classed blocker, major, or minor. Use verdict needs-fix when any blocker or major finding exists; otherwise use clean. Do not modify files, post to GitHub, approve, request changes, or spawn subagents. The runner posts a comment-only review.`;
}

/** builds the fix prompt from reviewer claims that still require verification */
function fixPrompt(task: WaveTask, findings: readonly ReviewFinding[]): string {
    return `You are the fix worker for beads issue ${task.id} on branch ${task.branch}.

First re-verify every reviewer claim against the code and task contract. Fix confirmed findings only and reject incorrect findings with a concise reason.

TASK SPEC:
${task.spec}

NON-MINOR REVIEW CLAIMS:
${JSON.stringify(findings, null, 2)}

Do not commit, push, merge, run bd, post reviews, or spawn subagents. The runner owns Git and GitHub mutations. Return exactly one fixed or rejected disposition for every finding ID.`;
}

/** creates the concrete local-process runtime for one wave */
export function createCodexWaveRuntime(): WaveRuntime {
    const workspaces = new Map<string, TaskWorkspace>();
    let setupQueue: Promise<void> = Promise.resolve();

    /** serializes beads claims and worktree creation against shared repository metadata */
    async function prepareWorktree(
        task: WaveTask,
        definition: WaveDefinition,
        baseSha: string,
    ): Promise<string> {
        let worktree = "";
        const preparation = setupQueue.then(async () => {
            await runCommand("bd", ["update", task.id, "--claim"], definition.repo);
            const root = await mkdtemp(path.join(tmpdir(), `${definition.name}-`));
            worktree = path.join(root, task.id.replaceAll(".", "-"));
            await runCommand(
                "git",
                ["worktree", "add", "-b", task.branch, worktree, baseSha],
                definition.repo,
            );
            workspaces.set(task.id, { path: worktree, prNumber: null });
        });
        setupQueue = preparation.then(
            () => undefined,
            () => undefined,
        );
        await preparation;
        return worktree;
    }

    /** performs deterministic guard checks before any model runs */
    async function guard(definition: WaveDefinition): Promise<GuardResult> {
        const failures: string[] = [];
        const dirty = await runCommand(
            "git",
            ["status", "--porcelain", "--untracked-files=all"],
            definition.repo,
        );
        if (dirty.stdout.trim().length > 0) {
            failures.push(`working tree is dirty:\n${dirty.stdout.trim()}`);
        }

        const branch = await runCommand(
            "git",
            ["symbolic-ref", "--short", "HEAD"],
            definition.repo,
        );
        if (branch.stdout.trim() !== definition.baseBranch) {
            failures.push(`expected attached ${definition.baseBranch}, found ${branch.stdout.trim()}`);
        }

        const fetchFailure = await commandFailure("git", ["fetch", "origin"], definition.repo);
        if (fetchFailure !== null) failures.push(fetchFailure);

        const localSha = await runCommand("git", ["rev-parse", "HEAD"], definition.repo);
        const remoteSha = await runCommand(
            "git",
            ["rev-parse", `origin/${definition.baseBranch}`],
            definition.repo,
        );
        if (localSha.stdout.trim() !== remoteSha.stdout.trim()) {
            failures.push(`${definition.baseBranch} is not in sync with origin/${definition.baseBranch}`);
        }

        const authFailure = await commandFailure("gh", ["auth", "status"], definition.repo);
        if (authFailure !== null) failures.push(authFailure);

        for (const check of definition.dependencyChecks) {
            try {
                const content = await runCommand(
                    "git",
                    ["show", `origin/${definition.baseBranch}:${check.path}`],
                    definition.repo,
                );
                if (!content.stdout.includes(check.pattern)) {
                    failures.push(check.description);
                }
            } catch {
                failures.push(check.description);
            }
        }

        try {
            await runQualityGate(definition, definition.repo);
        } catch (error) {
            failures.push(error instanceof Error ? error.message : String(error));
        }

        return {
            ok: failures.length === 0,
            baseSha: remoteSha.stdout.trim(),
            failures,
        };
    }

    /** runs one implementation worker, then owns gate, commit, push, and PR creation */
    async function implement(
        task: WaveTask,
        definition: WaveDefinition,
        baseSha: string,
    ): Promise<ImplementationResult> {
        const worktree = await prepareWorktree(task, definition, baseSha);
        try {
            await runCommand("npm", ["ci"], worktree);

            const agentOutput = await runCodexAgent(
                worktree,
                definition.models.implement,
                "workspace-write",
                implementationPrompt(task),
                IMPLEMENTATION_SCHEMA,
            );
            parseImplementationResult(agentOutput);
            await assertHeadUnchanged(worktree, baseSha);
            await runQualityGate(definition, worktree);

            const changes = await changedFiles(worktree);
            const files = changes.all;
            if (files.length === 0) throw new Error(`${task.id} produced no file changes`);
            assertNoUntrackedMarkdown(changes.untracked);
            await runCommand("git", ["add", "-A", "--", ...files], worktree);
            await runCommand("git", ["commit", "-m", task.commitMessage], worktree);
            await runCommand(
                "git",
                ["push", "--set-upstream", "origin", task.branch],
                worktree,
            );

            const pr = await runCommand(
                "gh",
                [
                    "pr",
                    "create",
                    "--base",
                    definition.baseBranch,
                    "--head",
                    task.branch,
                    "--title",
                    task.title,
                    "--body",
                    `Implements beads issue ${task.id}.`,
                ],
                worktree,
            );
            const prNumber = parsePrNumber(pr.stdout);
            workspaces.set(task.id, { path: worktree, prNumber });
            return { branch: task.branch, changedFiles: files, prNumber };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`${message}\ndiagnostic worktree: ${worktree}`);
        }
    }

    /** runs an independent read-only review and posts it as comment-only */
    async function review(
        task: WaveTask,
        implementation: ImplementationResult,
        definition: WaveDefinition,
        baseSha: string,
    ): Promise<ReviewResult> {
        const workspace = workspaces.get(task.id);
        if (workspace === undefined || workspace.prNumber === null) {
            throw new Error(`missing completed implementation for ${task.id}`);
        }
        const agentOutput = await runCodexAgent(
            definition.repo,
            definition.models.review,
            "read-only",
            reviewerPrompt(task, implementation, baseSha),
            REVIEW_SCHEMA,
        );
        const result = parseReviewResult(agentOutput);
        const hasNonMinor = result.findings.some((finding) => finding.class !== "minor");
        if ((result.verdict === "needs-fix") !== hasNonMinor) {
            throw new Error(`review verdict is inconsistent with findings for ${task.id}`);
        }
        await runCommand(
            "gh",
            [
                "pr",
                "review",
                String(workspace.prNumber),
                "--comment",
                "--body",
                reviewBody(task, result),
            ],
            definition.repo,
        );
        return result;
    }

    /** fixes verified findings, then owns gate, commit, and push */
    async function fix(
        task: WaveTask,
        findings: readonly ReviewFinding[],
        definition: WaveDefinition,
    ): Promise<FixResult> {
        const workspace = workspaces.get(task.id);
        if (workspace === undefined) throw new Error(`missing workspace for ${task.id}`);
        const before = await runCommand("git", ["rev-parse", "HEAD"], workspace.path);
        const agentOutput = await runCodexAgent(
            workspace.path,
            definition.models.fix,
            "workspace-write",
            fixPrompt(task, findings),
            FIX_SCHEMA,
        );
        const result = parseFixResult(agentOutput);
        const expectedIds = findings.map((finding) => finding.id).sort();
        const dispositionIds = [...result.fixed, ...result.rejected]
            .map((disposition) => disposition.findingId)
            .sort();
        if (
            dispositionIds.length !== expectedIds.length ||
            dispositionIds.some((id, index) => id !== expectedIds[index])
        ) {
            throw new Error(`fix worker did not disposition every finding for ${task.id}`);
        }
        await assertHeadUnchanged(workspace.path, before.stdout.trim());

        const changes = await changedFiles(workspace.path);
        const files = changes.all;
        if (files.length > 0) {
            assertNoUntrackedMarkdown(changes.untracked);
            await runQualityGate(definition, workspace.path);
            await runCommand("git", ["add", "-A", "--", ...files], workspace.path);
            await runCommand(
                "git",
                ["commit", "-m", `fix: address review findings for ${task.id}`],
                workspace.path,
            );
            await runCommand("git", ["push", "origin", task.branch], workspace.path);
        } else if (result.fixed.length > 0) {
            throw new Error(`fix worker claimed fixes without changing files for ${task.id}`);
        }
        return result;
    }

    /** removes a successful task's temporary worktree */
    async function finish(task: WaveTask, definition: WaveDefinition): Promise<void> {
        const workspace = workspaces.get(task.id);
        if (workspace === undefined) return;
        await runCommand(
            "git",
            ["worktree", "remove", "--force", workspace.path],
            definition.repo,
        );
        workspaces.delete(task.id);
    }

    return { guard, implement, review, fix, finish };
}
