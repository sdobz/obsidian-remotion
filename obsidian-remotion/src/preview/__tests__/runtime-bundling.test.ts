/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    initializeEsbuild,
    setupRuntimeTest,
    bundleMarkdown,
    type RuntimeTestContext,
} from "./test-utils";

describe("esbuild Bundling Integration", () => {
    let esbuildInstance: any;
    let examplesDir: string;
    let ctx: RuntimeTestContext;

    beforeEach(async () => {
        const result = initializeEsbuild();
        esbuildInstance = result.esbuildInstance;
        examplesDir = result.examplesDir;
        ctx = await setupRuntimeTest();
    });

    afterEach(async () => {
        await ctx.runtime.unmount();
    });

    it("loads esbuild from node_modules", () => {
        expect(esbuildInstance).toBeTruthy();
        expect(esbuildInstance.build).toBeDefined();
    });

    it("bundles and executes markdown through Runtime (matching Obsidian flow)", async () => {
        // This bundle has no render() calls, so __handleCommand is registered but
        // handleBundle() finds no components → no widget-status is emitted.
        // We verify the runtime loaded successfully (no runtime-error) and that
        // __handleCommand is now available in the iframe window.
        const markdown = `
\`\`\`tsx
import React from "react";
export const MyComponent = () => <div>Hello from Bundle</div>;
\`\`\`
`;

        const result = await bundleMarkdown({
            markdown,
            esbuildInstance,
            examplesDir,
        });

        expect(result.bundleStatus.status).toBe("ok");
        expect(result.bundleCode).toBeTruthy();

        ctx.runtime.updateBundle(result.bundleCode);
        // Give the IIFE time to eval and register __handleCommand
        await new Promise(resolve => setTimeout(resolve, 1000));

        expect(ctx.runtimeErrors).toHaveLength(0);

        // __handleCommand is registered by obsidian-remotion-runtime/iframe preamble
        const iframeWindow = ctx.runtime.getContentWindow() as any;
        expect(typeof iframeWindow.__handleCommand).toBe("function");
        // No render() calls → no components registered
        expect(iframeWindow.__dumpRuntimeState?.()?.previewComponents ?? 0).toBe(0);
    });

    it("resolves React and remotion dependencies through complete flow", async () => {
        // Uses render() so widget-status will be emitted.
        // Imports from remotion to verify the dependency chain resolves correctly.
        // Avoids hooks that require Remotion composition context (e.g. useCurrentFrame,
        // useVideoConfig) – those throw when rendered outside a <Composition>.
        const markdown = `
\`\`\`tsx
import React from "react";
import { render } from "obsidian-remotion-runtime";
// Import a non-hook export from remotion to verify dep resolution
import { interpolate } from "remotion";

const TestComponent = () => {
  // Use interpolate (a pure function) to verify remotion is usable
  const opacity = interpolate(0, [0, 30], [0, 1]);
  return <div style={{ opacity }}>Remotion deps resolved</div>;
};

render(TestComponent, { width: 1920, height: 1080, fps: 30, durationInFrames: 60 });
\`\`\`
`;

        const result = await bundleMarkdown({
            markdown,
            esbuildInstance,
            examplesDir,
        });

        expect(result.bundleStatus.status).toBe("ok");
        expect(result.bundleCode).toBeTruthy();

        ctx.runtime.updateBundle(result.bundleCode);
        await ctx.waitFor("widget-status", 10000);

        expect(ctx.runtimeErrors).toHaveLength(0);
        expect(ctx.widgetStatuses.length).toBeGreaterThan(0);

        const iframeWindow = ctx.runtime.getContentWindow() as any;
        expect(typeof iframeWindow.__handleCommand).toBe("function");
        expect(iframeWindow.__dumpRuntimeState?.()?.previewComponents ?? 0).toBe(1);
    });
});

