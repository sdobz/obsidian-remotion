/**
 * @vitest-environment node
 *
 * Remotion Integration Tests (render() syntax)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
    initializeEsbuild,
    setupRuntimeTest,
    bundleMarkdown,
} from "./test-utils";

describe("Remotion Integration - render() pipeline", () => {
    let esbuildInstance: any;
    let examplesDir: string;

    beforeEach(() => {
        const result = initializeEsbuild();
        esbuildInstance = result.esbuildInstance;
        examplesDir = result.examplesDir;
    });

    it("executes bundle with no render() calls", async () => {
        const markdown = `
\`\`\`tsx
import React from "react";

// Just some code, no exports
const MyComp = () => <div>Hello</div>;
\`\`\`
`;

        const result = await bundleMarkdown({
            markdown,
            esbuildInstance,
            examplesDir,
        });

        expect(result.bundleStatus.status).toBe("ok");
        expect(result.bundleCode).toBeTruthy();

        const ctx = await setupRuntimeTest();
        ctx.runtime.updateBundle(result.bundleCode);

        await new Promise(resolve => setTimeout(resolve, 500));

        expect(ctx.runtimeErrors).toHaveLength(0);

        const iframe = ctx.runtime.getIframe();
        const widgetsContainer = iframe!.contentDocument!.getElementById("widgets-container");
        expect(widgetsContainer!.children.length).toBe(0);

        await ctx.runtime.unmount();
    });

    it("renders one item from one render() call", async () => {
        const markdown = `
\`\`\`tsx
import React from "react";
import { render } from "obsidian-remotion-runtime";

const MyComp = () => <div>Hello</div>;
render(MyComp, { width: 1920, height: 1080, fps: 30, durationInFrames: 60 });
\`\`\`
`;

        const result = await bundleMarkdown({
            markdown,
            esbuildInstance,
            examplesDir,
        });

        expect(result.bundleStatus.status).toBe("ok");

        const ctx = await setupRuntimeTest();
        ctx.runtime.updateBundle(result.bundleCode);
        await new Promise(resolve => setTimeout(resolve, 500));

        const iframe = ctx.runtime.getIframe();
        const widgetsContainer = iframe!.contentDocument!.getElementById("widgets-container");
        expect(widgetsContainer!.children.length).toBe(1);

        await ctx.runtime.unmount();
    });

    it("renders multiple items from multiple render() calls", async () => {
        const markdown = `
\`\`\`tsx
import React from "react";
import { render } from "obsidian-remotion-runtime";

const One = () => <div>One</div>;
const Two = () => <div>Two</div>;

render(One, { width: 1920, height: 1080, fps: 30, durationInFrames: 60 });
render(Two, { width: 1280, height: 720, fps: 24, durationInFrames: 90 });
\`\`\`
`;

        const result = await bundleMarkdown({
            markdown,
            esbuildInstance,
            examplesDir,
        });

        expect(result.bundleStatus.status).toBe("ok");

        const ctx = await setupRuntimeTest();
        ctx.runtime.updateBundle(result.bundleCode);
        await new Promise(resolve => setTimeout(resolve, 800));

        expect(ctx.runtimeErrors).toHaveLength(0);
        const iframe = ctx.runtime.getIframe();
        const widgetsContainer = iframe!.contentDocument!.getElementById("widgets-container");
        expect(widgetsContainer!.children.length).toBe(2);

        await ctx.runtime.unmount();
    });

    it("exposes iframe debug dump for inspection", async () => {
        const markdown = `
\`\`\`tsx
import React from "react";
import { render } from "obsidian-remotion-runtime";

const Comp = () => <div>Debug me</div>;
render(Comp, { width: 1000, height: 500, fps: 30, durationInFrames: 45 });
\`\`\`
`;

        const result = await bundleMarkdown({
            markdown,
            esbuildInstance,
            examplesDir,
        });

        expect(result.bundleStatus.status).toBe("ok");

        const ctx = await setupRuntimeTest();
        ctx.runtime.updateBundle(result.bundleCode);
        await new Promise(resolve => setTimeout(resolve, 800));

        expect(ctx.runtimeErrors).toHaveLength(0);

        const iframeWindow = ctx.runtime.getContentWindow() as any;
        const dump = iframeWindow.__dumpRuntimeState?.();

        expect(dump).toBeDefined();
        expect(dump.previewComponents).toBe(1);
        expect(dump.widgetDomCount).toBe(1);
        expect(dump.loadingHidden).toBe(true);

        await ctx.runtime.unmount();
    });
});
