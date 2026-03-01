import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/preview/__tests__/runtime.test.ts"],
        environment: "jsdom",
        environmentOptions: {
            jsdom: {
                resources: "usable",
                runScripts: "dangerously",
            },
        },
        globals: true,
    },
});