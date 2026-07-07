import { defineConfig } from "vitest/config";

// dedicated vitest config for the sim engine tests. the ported Simulation core
// is headless (no DOM/canvas), so unlike powder-lab these tests need no canvas
// shims — they run in plain node and read the raw cells/heat arrays directly.
export default defineConfig({
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
    },
});
