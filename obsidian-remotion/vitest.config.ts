import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/**/*.test.ts"],
        environment: "node",
        environmentMatchGlobs: [
            ["src/preview/__tests__/runtime.test.ts", "jsdom"],
        ],
        environmentOptions: {
            jsdom: {
                resources: "usable",
                runScripts: "dangerously",
            },
        },
        globals: true,
        testTimeout: 30000,
    },
    resolve: {
        alias: {
            "remotion-md": "/home/vkhougaz/projects/obsidian-remotion/remotion-md/src/index.ts",
        },
    },
});