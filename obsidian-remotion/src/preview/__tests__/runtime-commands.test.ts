/**
 * @vitest-environment node
 *
 * Integration tests for the full IframeCommand protocol.
 *
 * Architecture under test:
 *   1. BundlePipeline (esbuild) synthesises user markdown into an IIFE that
 *      includes `obsidian-remotion-runtime/iframe` as a preamble side-effect.
 *   2. The IIFE is sent as the first `bundle` postMessage to iframe.html.
 *   3. The bootstrap in iframe.html evals the IIFE, which runs
 *      obsidian-remotion-runtime/iframe (registering window.__handleCommand)
 *      and then user code (populating window.__previewComponents via render()).
 *   4. The bootstrap then calls window.__handleCommand({ type: "bundle" }) so
 *      the runtime activates the registered components.
 *   5. Subsequent commands (reflow, scroll, reset, show-error, clear-error) are
 *      routed directly to window.__handleCommand by the bootstrap.
 *
 * Tests use real esbuild bundling – no mocks.
 * Tests FAIL if __handleCommand is not registered (runtime bundle broken).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initializeEsbuild, setupRuntimeTest, bundleMarkdown, type RuntimeTestContext } from "./test-utils";

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
    // bootstrap sanity
    // -----------------------------------------------------------------------

    it("becomes ready after mount – iframe bootstrap alive before any bundle", () => {
        expect(ctx.runtime.getIframe()).not.toBeNull();
        expect(ctx.runtimeErrors).toHaveLength(0);
    });

    // -----------------------------------------------------------------------
    // bundle command – React rendering via real runtime
    // -----------------------------------------------------------------------

    it("bundle with no render() calls: no widget-status and empty widgets-container", async () => {
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
        // No render() calls → no widget-status emitted; wait for loading to clear
        await new Promise(resolve => setTimeout(resolve, 800));

        expect(ctx.runtimeErrors).toHaveLength(0);
        // No widget-status since nothing was rendered
        expect(ctx.widgetStatuses).toHaveLength(0);
        const widgetsContainer = ctx.runtime.getIframe()!.contentDocument!.getElementById("widgets-container")!;
        expect(widgetsContainer.children.length).toBe(0);
    });

    it("bundle with one render(): widget-status emitted with heights, one DOM child", async () => {
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
        await ctx.waitFor("widget-status", 5000);

        expect(ctx.runtimeErrors).toHaveLength(0);
        expect(ctx.widgetStatuses.length).toBeGreaterThan(0);
        // Heights must be real numbers > 0
        expect(ctx.widgetStatuses[0]).toHaveLength(1);
        expect(ctx.widgetStatuses[0][0]).toBeGreaterThan(0);

        const widgetsContainer = ctx.runtime.getIframe()!.contentDocument!.getElementById("widgets-container")!;
        expect(widgetsContainer.querySelectorAll("[data-component-name]").length).toBe(1);
    });

    it("bundle with two render() calls: two DOM children", async () => {
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
        await ctx.waitFor("widget-status", 5000);

        expect(ctx.runtimeErrors).toHaveLength(0);
        const widgetsContainer = ctx.runtime.getIframe()!.contentDocument!.getElementById("widgets-container")!;
        expect(widgetsContainer.querySelectorAll("[data-component-name]").length).toBe(2);
    });

    it("bundle that throws at top-level emits runtime-error (no widget-status)", async () => {
        const result = await bundleMarkdown({
            markdown: `
\`\`\`tsx
throw new Error("intentional top-level error");
\`\`\`
`,
            esbuildInstance,
            examplesDir,
        });
        expect(result.bundleStatus.status).toBe("ok");

        ctx.runtime.updateBundle(result.bundleCode);
        await ctx.waitFor("runtime-error", 5000);

        expect(ctx.runtimeErrors.length).toBeGreaterThan(0);
        expect(ctx.runtimeErrors[0].message).toContain("intentional top-level error");
        expect(ctx.widgetStatuses).toHaveLength(0);
    });

    it("successive bundle commands update widgets-container (not cumulative)", async () => {
        const mkBundle = (count: number) => bundleMarkdown({
            markdown: `
\`\`\`tsx
import React from "react";
import { render } from "obsidian-remotion-runtime";
${Array.from({ length: count }, (_, i) => `
const C${i} = () => <div>C${i}</div>;
render(C${i}, { width: 1920, height: 1080, fps: 30, durationInFrames: 60 });`).join("")}
\`\`\`
`,
            esbuildInstance,
            examplesDir,
        });

        ctx.runtime.updateBundle((await mkBundle(1)).bundleCode);
        await ctx.waitFor("widget-status", 5000);

        const widgetsContainer = ctx.runtime.getIframe()!.contentDocument!.getElementById("widgets-container")!;
        // Components are rendered inside a child container div by PlayerManager
        const countComponents = () =>
            widgetsContainer.querySelectorAll("[data-component-name]").length;

        expect(countComponents()).toBe(1);

        ctx.runtime.updateBundle((await mkBundle(2)).bundleCode);
        await ctx.waitFor("widget-status", 5000);

        expect(countComponents()).toBe(2);
        expect(ctx.runtimeErrors).toHaveLength(0);
    });

    // -----------------------------------------------------------------------
    // Commands that require __handleCommand (need a bundle loaded first)
    // -----------------------------------------------------------------------

    /** Load a minimal bundle to install the runtime __handleCommand */
    async function loadMinimalBundle() {
        const result = await bundleMarkdown({
            markdown: `
\`\`\`tsx
import React from "react";
import { render } from "obsidian-remotion-runtime";
const Stub = () => <div/>;
render(Stub, { width: 100, height: 100, fps: 30, durationInFrames: 1 });
\`\`\`
`,
            esbuildInstance,
            examplesDir,
        });
        ctx.runtime.updateBundle(result.bundleCode);
        await ctx.waitFor("widget-status", 5000);
    }

    // -----------------------------------------------------------------------
    // reset command
    // -----------------------------------------------------------------------

    it("reset command clears widgets-container", async () => {
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
        await ctx.waitFor("widget-status", 5000);

        const widgetsContainer = ctx.runtime.getIframe()!.contentDocument!.getElementById("widgets-container")!;
        expect(widgetsContainer.children.length).toBe(1);

        ctx.runtime.reset();
        await new Promise(resolve => setTimeout(resolve, 200));

        expect(widgetsContainer.children.length).toBe(0);
    });

    // -----------------------------------------------------------------------
    // show-error / clear-error commands
    // -----------------------------------------------------------------------

    it("show-error makes #error-overlay visible", async () => {
        await loadMinimalBundle();

        ctx.runtime.showError("Something went wrong", "stack trace here");
        await new Promise(resolve => setTimeout(resolve, 100));

        const overlay = ctx.runtime.getIframe()!.contentDocument!.getElementById("error-overlay")!;
        expect(overlay.classList.contains("visible")).toBe(true);
    });

    it("show-error sets #error-message text", async () => {
        await loadMinimalBundle();

        ctx.runtime.showError("Specific error text", "");
        await new Promise(resolve => setTimeout(resolve, 100));

        const msgEl = ctx.runtime.getIframe()!.contentDocument!.getElementById("error-message")!;
        expect(msgEl.textContent).toContain("Specific error text");
    });

    it("clear-error hides #error-overlay", async () => {
        await loadMinimalBundle();

        ctx.runtime.showError("oops", "");
        await new Promise(resolve => setTimeout(resolve, 100));
        ctx.runtime.clearError();
        await new Promise(resolve => setTimeout(resolve, 100));

        const overlay = ctx.runtime.getIframe()!.contentDocument!.getElementById("error-overlay")!;
        expect(overlay.classList.contains("visible")).toBe(false);
    });

    // -----------------------------------------------------------------------
    // __dumpRuntimeState (registered by iframe/main.ts when bundle is eval'd)
    // -----------------------------------------------------------------------

    it("__dumpRuntimeState reflects state after bundle – requires real runtime", async () => {
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
        await ctx.waitFor("widget-status", 5000);

        const iframeWindow = ctx.runtime.getContentWindow() as any;
        // __dumpRuntimeState is registered by iframe/main.ts; if it's undefined
        // the runtime bundle failed to include obsidian-remotion-runtime/iframe
        expect(typeof iframeWindow.__dumpRuntimeState).toBe("function");

        const dump = iframeWindow.__dumpRuntimeState();
        expect(dump.previewComponents).toBe(1);
        expect(dump.widgetDomCount).toBe(1);
        expect(dump.loadingHidden).toBe(true);
        expect(dump.errorVisible).toBe(false);
    });
});

