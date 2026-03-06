/**
 * @vitest-environment node
 *
 * Integration tests for the full IframeCommand protocol.
 *
 * These tests use the real BundlePipeline + esbuild to produce bundles from
 * inline markdown, then drive them through the Runtime class (the plugin side)
 * into the iframe.html bootstrap (the iframe side).  The observable contract
 * verified here is:
 *
 *   - `bundle`      → widget-status received; DOM children appear in
 *                     #widgets-container for each render() call
 *   - `bundle` (err)→ runtime-error received; error message propagated
 *   - `reflow`      → command stored in iframe window.__lastReflow
 *   - `scroll`      → command stored in iframe window.__lastScroll
 *   - `reset`       → #widgets-container emptied
 *   - `show-error`  → #error-overlay gains .visible
 *   - `clear-error` → #error-overlay loses .visible
 *
 * No mocks.  Everything runs against the real bootstrap script in iframe.html
 * and the real esbuild bundler.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initializeEsbuild, setupRuntimeTest, bundleMarkdown, type RuntimeTestContext } from "./test-utils";

// ---------------------------------------------------------------------------
// Shared esbuild instance (initialised once per describe block)
// ---------------------------------------------------------------------------

describe("Runtime command protocol (real bundles)", () => {
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

    // -----------------------------------------------------------------------
    // bundle command
    // -----------------------------------------------------------------------

    it("becomes ready after mount – no bundle needed", () => {
        // setupRuntimeTest() awaits runtime-ready, so reaching here proves the
        // iframe bootstrap initialised successfully.
        expect(ctx.runtime.getIframe()).not.toBeNull();
        expect(ctx.runtimeErrors).toHaveLength(0);
    });

    it("bundle with no render() calls produces empty #widgets-container", async () => {
        const result = await bundleMarkdown({
            markdown: `
\`\`\`tsx
import React from "react";
const MyComp = () => <div>Hello</div>;
\`\`\`
`,
            esbuildInstance,
            examplesDir,
        });

        expect(result.bundleStatus.status).toBe("ok");

        ctx.runtime.updateBundle(result.bundleCode);
        await new Promise(resolve => setTimeout(resolve, 500));

        const iframe = ctx.runtime.getIframe()!;
        const widgetsContainer = iframe.contentDocument!.getElementById("widgets-container")!;
        expect(widgetsContainer.children.length).toBe(0);
        expect(ctx.runtimeErrors).toHaveLength(0);
    });

    it("bundle with one render() call produces one widget in DOM and emits widget-status", async () => {
        const result = await bundleMarkdown({
            markdown: `
\`\`\`tsx
import React from "react";
import { render } from "obsidian-remotion-runtime";

const MyComp = () => <div>Hello</div>;
render(MyComp, { width: 1920, height: 1080, fps: 30, durationInFrames: 60 });
\`\`\`
`,
            esbuildInstance,
            examplesDir,
        });

        expect(result.bundleStatus.status).toBe("ok");

        ctx.runtime.updateBundle(result.bundleCode);
        await new Promise(resolve => setTimeout(resolve, 600));

        const iframe = ctx.runtime.getIframe()!;
        const widgetsContainer = iframe.contentDocument!.getElementById("widgets-container")!;
        expect(widgetsContainer.children.length).toBe(1);
        expect(ctx.widgetStatuses.length).toBeGreaterThan(0);
        expect(ctx.runtimeErrors).toHaveLength(0);
    });

    it("bundle with two render() calls produces two widgets in DOM", async () => {
        const result = await bundleMarkdown({
            markdown: `
\`\`\`tsx
import React from "react";
import { render } from "obsidian-remotion-runtime";

const One = () => <div>One</div>;
const Two = () => <div>Two</div>;

render(One, { width: 1920, height: 1080, fps: 30, durationInFrames: 60 });
render(Two, { width: 1280, height: 720,  fps: 24, durationInFrames: 90 });
\`\`\`
`,
            esbuildInstance,
            examplesDir,
        });

        expect(result.bundleStatus.status).toBe("ok");

        ctx.runtime.updateBundle(result.bundleCode);
        await new Promise(resolve => setTimeout(resolve, 600));

        const iframe = ctx.runtime.getIframe()!;
        const widgetsContainer = iframe.contentDocument!.getElementById("widgets-container")!;
        expect(widgetsContainer.children.length).toBe(2);
        expect(ctx.runtimeErrors).toHaveLength(0);
    });

    it("bundle that throws at top-level emits runtime-error", async () => {
        const result = await bundleMarkdown({
            markdown: `
\`\`\`tsx
throw new Error("intentional top-level error");
\`\`\`
`,
            esbuildInstance,
            examplesDir,
        });

        // Bundling itself should succeed; the error happens at eval time
        expect(result.bundleStatus.status).toBe("ok");

        ctx.runtime.updateBundle(result.bundleCode);
        await new Promise(resolve => setTimeout(resolve, 500));

        expect(ctx.runtimeErrors.length).toBeGreaterThan(0);
        expect(ctx.runtimeErrors[0].message).toContain("intentional top-level error");
    });

    it("successive bundle commands update #widgets-container correctly", async () => {
        // First bundle: one component
        const first = await bundleMarkdown({
            markdown: `
\`\`\`tsx
import React from "react";
import { render } from "obsidian-remotion-runtime";

const A = () => <div>A</div>;
render(A, { width: 1920, height: 1080, fps: 30, durationInFrames: 60 });
\`\`\`
`,
            esbuildInstance,
            examplesDir,
        });

        ctx.runtime.updateBundle(first.bundleCode);
        await new Promise(resolve => setTimeout(resolve, 600));

        const iframe = ctx.runtime.getIframe()!;
        const widgetsContainer = iframe.contentDocument!.getElementById("widgets-container")!;
        expect(widgetsContainer.children.length).toBe(1);

        // Second bundle: two components
        const second = await bundleMarkdown({
            markdown: `
\`\`\`tsx
import React from "react";
import { render } from "obsidian-remotion-runtime";

const B = () => <div>B</div>;
const C = () => <div>C</div>;
render(B, { width: 1920, height: 1080, fps: 30, durationInFrames: 60 });
render(C, { width: 1280, height: 720,  fps: 24, durationInFrames: 90 });
\`\`\`
`,
            esbuildInstance,
            examplesDir,
        });

        ctx.runtime.updateBundle(second.bundleCode);
        await new Promise(resolve => setTimeout(resolve, 600));

        // Container should now show 2 (not cumulative 3)
        expect(widgetsContainer.children.length).toBe(2);
        expect(ctx.runtimeErrors).toHaveLength(0);
    });

    // -----------------------------------------------------------------------
    // reflow command
    // -----------------------------------------------------------------------

    it("reflow command is stored in iframe window.__lastReflow", async () => {
        // No bundle needed; reflow works even before any bundle
        ctx.runtime.reflow(
            1000,
            [{ center: 200, height: 100 }],
            1000,
            [{ center: 200, height: 100 }],
            [],
        );

        await new Promise(resolve => setTimeout(resolve, 100));

        const iframeWin = ctx.runtime.getContentWindow() as any;
        expect(iframeWin.__lastReflow).toBeDefined();
        expect(iframeWin.__lastReflow.type).toBe("reflow");
        expect(iframeWin.__lastReflow.bands).toHaveLength(1);
    });

    // -----------------------------------------------------------------------
    // scroll command
    // -----------------------------------------------------------------------

    it("scroll command is stored in iframe window.__lastScroll", async () => {
        ctx.runtime.scroll(42);
        await new Promise(resolve => setTimeout(resolve, 100));

        const iframeWin = ctx.runtime.getContentWindow() as any;
        expect(iframeWin.__lastScroll).toBe(42);
    });

    // -----------------------------------------------------------------------
    // reset command
    // -----------------------------------------------------------------------

    it("reset command clears #widgets-container", async () => {
        const result = await bundleMarkdown({
            markdown: `
\`\`\`tsx
import React from "react";
import { render } from "obsidian-remotion-runtime";

const Comp = () => <div>Hello</div>;
render(Comp, { width: 1920, height: 1080, fps: 30, durationInFrames: 60 });
\`\`\`
`,
            esbuildInstance,
            examplesDir,
        });

        ctx.runtime.updateBundle(result.bundleCode);
        await new Promise(resolve => setTimeout(resolve, 600));

        const iframe = ctx.runtime.getIframe()!;
        const widgetsContainer = iframe.contentDocument!.getElementById("widgets-container")!;
        expect(widgetsContainer.children.length).toBe(1);

        ctx.runtime.reset();
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(widgetsContainer.children.length).toBe(0);
    });

    // -----------------------------------------------------------------------
    // show-error / clear-error commands
    // -----------------------------------------------------------------------

    it("show-error command makes #error-overlay visible", async () => {
        ctx.runtime.showError("Something went wrong", "stack trace here");
        await new Promise(resolve => setTimeout(resolve, 100));

        const iframeDoc = ctx.runtime.getIframe()?.contentDocument;
        const overlay = iframeDoc?.getElementById("error-overlay");
        expect(overlay?.classList.contains("visible")).toBe(true);
    });

    it("show-error message text appears in #error-message", async () => {
        ctx.runtime.showError("Specific error text", "");
        await new Promise(resolve => setTimeout(resolve, 100));

        const iframeDoc = ctx.runtime.getIframe()?.contentDocument;
        const msgEl = iframeDoc?.getElementById("error-message");
        expect(msgEl?.textContent).toContain("Specific error text");
    });

    it("clear-error hides #error-overlay after show-error", async () => {
        ctx.runtime.showError("oops", "");
        await new Promise(resolve => setTimeout(resolve, 100));

        ctx.runtime.clearError();
        await new Promise(resolve => setTimeout(resolve, 100));

        const iframeDoc = ctx.runtime.getIframe()?.contentDocument;
        const overlay = iframeDoc?.getElementById("error-overlay");
        expect(overlay?.classList.contains("visible")).toBe(false);
    });

    // -----------------------------------------------------------------------
    // Debug dump
    // -----------------------------------------------------------------------

    it("__dumpRuntimeState reflects current iframe state after bundle", async () => {
        const result = await bundleMarkdown({
            markdown: `
\`\`\`tsx
import React from "react";
import { render } from "obsidian-remotion-runtime";

const Comp = () => <div>Debug me</div>;
render(Comp, { width: 1000, height: 500, fps: 30, durationInFrames: 45 });
\`\`\`
`,
            esbuildInstance,
            examplesDir,
        });

        ctx.runtime.updateBundle(result.bundleCode);
        await new Promise(resolve => setTimeout(resolve, 600));

        const iframeWindow = ctx.runtime.getContentWindow() as any;
        const dump = iframeWindow.__dumpRuntimeState?.();

        expect(dump).toBeDefined();
        expect(dump.previewComponents).toBe(1);
        expect(dump.widgetDomCount).toBe(1);
        expect(dump.loadingHidden).toBe(true);
        expect(dump.errorVisible).toBe(false);
    });
});
