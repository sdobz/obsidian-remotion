/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
    initializeEsbuild,
    setupRuntimeTest,
    bundleMarkdown,
    executeBundle,
} from "./test-utils";

describe("esbuild Bundling Integration", () => {
    let esbuildInstance: any;
    let examplesDir: string;

    beforeEach(() => {
        const result = initializeEsbuild();
        esbuildInstance = result.esbuildInstance;
        examplesDir = result.examplesDir;
    });

    it("loads esbuild from node_modules", () => {
        expect(esbuildInstance).toBeTruthy();
        expect(esbuildInstance.build).toBeDefined();
    });

    it("bundles and executes markdown through Runtime (matching Obsidian flow)", async () => {
        const markdown = `
\`\`\`tsx
export const MyComponent = () => <div>Hello from Bundle</div>;
\`\`\`
`;

        // Step 1: Bundle in Node environment (matches main.ts bundle() method)
        const result = await bundleMarkdown({
            markdown,
            esbuildInstance,
            examplesDir,
        });

        expect(result.bundleStatus.status).toBe("ok");
        expect(result.bundleCode).toBeTruthy();

        // Step 2: Execute bundle through Runtime (matches PreviewView.updateBundleOutput)
        const ctx = await setupRuntimeTest();

        const executeResult = await executeBundle(ctx, result.bundleCode);

        if (!executeResult.success) {
            console.error("Runtime error:", executeResult.error);
            throw new Error(`Bundle execution failed: ${executeResult.error?.message}`);
        }

        expect(executeResult.success).toBe(true);
        expect(ctx.runtimeErrors).toHaveLength(0);

        // Verify bundle executed and set window.RuntimeBundle in iframe
        const iframeWindow = ctx.runtime.getContentWindow();
        expect(iframeWindow).toBeTruthy();
        expect((iframeWindow as any).RuntimeBundle).toBeDefined();
        expect((iframeWindow as any).RuntimeBundle.MyComponent).toBeDefined();

        await ctx.runtime.unmount();
    });

    it("resolves React and remotion dependencies through complete flow", async () => {
        // Create markdown that imports React and remotion
        const markdown = `
\`\`\`tsx
import React from "react";
import { useCurrentFrame } from "remotion";

export const TestComponent = () => {
  const frame = useCurrentFrame();
  return React.createElement('div', null, 'Frame: ' + frame);
};
\`\`\`
`;

        // Step 1: Bundle in Node environment
        const result = await bundleMarkdown({
            markdown,
            esbuildInstance,
            examplesDir,
        });

        expect(result.bundleStatus.status).toBe("ok");
        expect(result.bundleCode).toBeTruthy();

        // Step 2: Execute through Runtime
        const ctx = await setupRuntimeTest();

        const executeResult = await executeBundle(ctx, result.bundleCode);

        if (!executeResult.success) {
            console.error("Runtime error:", executeResult.error);
            throw new Error(`Dependency resolution failed: ${executeResult.error?.message}`);
        }

        expect(executeResult.success).toBe(true);
        expect(ctx.runtimeErrors).toHaveLength(0);

        // Verify the bundle executed correctly in the iframe
        const iframeWindow = ctx.runtime.getContentWindow();
        expect(iframeWindow).toBeTruthy();
        expect((iframeWindow as any).RuntimeBundle).toBeDefined();
        expect((iframeWindow as any).RuntimeBundle.TestComponent).toBeDefined();

        await ctx.runtime.unmount();
    });
});

