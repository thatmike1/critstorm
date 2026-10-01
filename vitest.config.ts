import { defineConfig } from "vitest/config";

// dedicated vitest config for the sim engine tests. the ported Simulation core
// is headless (no DOM/canvas), so unlike powder-lab these tests need no canvas
// shims — they run in plain node and read the raw cells/heat arrays directly.
export default defineConfig({
    test: {
        environment: "node",
        // seeded balance cohorts are CPU-bound; keep the shared ARM box quiet.
        maxWorkers: 1,
        testTimeout: 60_000,
        include: ["src/**/*.test.ts", "sim/**/*.test.ts", "scripts/**/*-test.ts"],
    },
});
