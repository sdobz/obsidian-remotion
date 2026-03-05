/**
 * @vitest-environment jsdom
 *
 * Unit tests for the full IframeCommand protocol between Runtime (plugin side)
 * and the iframe bootstrap + runtime bundle (iframe side).
 *
 * These tests verify the observable contract:
 *   - Each command sent via Runtime.* produces the expected DOM change or
 *     outbound PreviewMessage in the iframe.
 *   - Tests are fully self-contained: no Obsidian, no esbuild, no file system.
 *
 * Architecture note:
 *   iframe.html (bootstrap) executes the payload of the first `bundle` command,
 *   which registers `window.__handleCommand`. Subsequent commands are routed
 *   there. The tests inject a synthetic "runtime bundle" that installs a minimal
 *   __handleCommand able to exercise each command path.
 */

import { JSDOM } from "jsdom";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Runtime, type RuntimeDelegate, type RuntimeMessage } from "../runtime";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createJsdomDelegate(): {
    delegate: RuntimeDelegate;
    createContainer: () => HTMLElement;
    window: Window;
} {
    const jsdom = new JSDOM("<!DOCTYPE html><body></body>", {
        runScripts: "dangerously",
        url: "http://localhost",
    });
    const win = jsdom.window as unknown as Window;

    const delegate: RuntimeDelegate = {
        getHostWindow: () => win,
        prepareContainer(container: HTMLElement) {
            container.innerHTML = "";
            container.classList.add("remotion-preview-container");
        },
    };

    return {
        delegate,
        window: win,
        createContainer() {
            const el = win.document.createElement("div");
            win.document.body.appendChild(el);
            return el;
        },
    };
}

/** Wait for a specific message type arriving at the host window. */
function waitForMessage(
    hostWindow: Window,
    type: RuntimeMessage["type"],
    timeoutMs = 2000,
): Promise<RuntimeMessage> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`Timeout waiting for message: ${type}`)),
            timeoutMs,
        );
        const handler = (event: MessageEvent) => {
            const msg = event.data as RuntimeMessage;
            if (msg && msg.type === type) {
                clearTimeout(timer);
                hostWindow.removeEventListener("message", handler);
                resolve(msg);
            }
        };
        hostWindow.addEventListener("message", handler);
    });
}

/**
 * Build a minimal synthetic runtime bundle.
 *
 * This is the IIFE that the bootstrap in iframe.html executes on the first
 * `bundle` command. It installs `window.__handleCommand` and provides the
 * minimal DOM elements that iframe/main.ts expects (we create them in the
 * bundle itself since we're not loading the full iframe.html here).
 *
 * The bundle records commands in `window.__commandLog` for test assertions.
 */
const SYNTHETIC_RUNTIME_BUNDLE = `
(function() {
    // Ensure required DOM elements exist (normally provided by iframe.html)
    function ensureEl(id, tag) {
        var el = document.getElementById(id);
        if (!el) {
            el = document.createElement(tag || "div");
            el.id = id;
            document.body.appendChild(el);
        }
        return el;
    }
    ensureEl("loading-screen");
    ensureEl("widgets-container");
    ensureEl("widgets-scroller");
    ensureEl("bands-container");
    ensureEl("bands-scroller");
    ensureEl("link-overlay", "svg");
    ensureEl("debug-content");
    ensureEl("error-overlay");
    ensureEl("error-message");

    window.__commandLog = window.__commandLog || [];

    window.__handleCommand = function(cmd) {
        window.__commandLog.push(cmd);

        if (cmd.type === "bundle") {
                    // Simulate executing user code — use globalThis to avoid jsdom scope confusion
                    var self = (function() { return this; })() || globalThis;
                    self.__previewComponents = [];
                    self.__previewOptions = [];
                    try {
                        var fn = new Function(cmd.payload);
                        fn();
                    } catch(e) {
                        window.parent.postMessage({
                            type: "runtime-error",
                            error: { message: e.message, stack: e.stack }
                        }, "*");
                        return;
                    }
                    var comps = self.__previewComponents || [];
                    var count = comps.length;
                    var widgets = [];
                    for (var i = 0; i < count; i++) widgets.push({ height: 100 });
                    window.parent.postMessage({ type: "widget-status", widgets: widgets }, "*");
                }        if (cmd.type === "reflow") {
            window.__lastReflow = cmd;
        }

        if (cmd.type === "scroll") {
            window.__lastScroll = cmd.editorScrollTop;
        }

        if (cmd.type === "reset") {
            window.__previewComponents = [];
            window.__commandLog = [];
        }

        if (cmd.type === "show-error") {
            var overlay = document.getElementById("error-overlay");
            if (overlay) overlay.classList.add("visible");
            var msg = document.getElementById("error-message");
            if (msg) msg.textContent = cmd.message;
        }

        if (cmd.type === "clear-error") {
            var overlay = document.getElementById("error-overlay");
            if (overlay) overlay.classList.remove("visible");
        }
    };

    // Signal that the runtime bundle is loaded and ready
    window.parent.postMessage({ type: "runtime-ready" }, "*");
})();
`;

/** User code that registers one render() component */
const USER_CODE_ONE_COMPONENT = `
(function(w) {
    w.__previewComponents = w.__previewComponents || [];
    w.__previewOptions = w.__previewOptions || [];
    w.__previewComponents.push(function MyComp() {});
    w.__previewOptions.push({ width: 1920, height: 1080 });
})(typeof window !== "undefined" ? window : globalThis);
`;

/** User code that throws */
const USER_CODE_THROWS = `throw new Error("intentional test error");`;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Runtime command protocol", () => {
    let runtime: Runtime;
    let hostWindow: Window;
    let cleanup: () => Promise<void>;
    let receivedWidgetStatuses: number[][];
    let receivedErrors: Array<{ message: string; stack: string }>;

    beforeEach(async () => {
        const { delegate, createContainer, window: win } = createJsdomDelegate();
        hostWindow = win;
        runtime = new Runtime(delegate);

        receivedWidgetStatuses = [];
        receivedErrors = [];

        runtime.setHandlers({
            onRuntimeError: (m, s) => receivedErrors.push({ message: m, stack: s }),
            onWidgetStatus: (heights) => receivedWidgetStatuses.push(heights),
            onWidgetScroll: () => { },
            onReady: () => { },
        });

        await runtime.mount(createContainer());

        cleanup = async () => {
            await runtime.unmount();
        };
    });

    afterEach(async () => {
        await cleanup();
    });

    // -----------------------------------------------------------------------

    it("becomes ready after mount", () => {
        // mount() awaits runtime-ready, so if we reach here the iframe is alive
        expect(runtime.getIframe()).not.toBeNull();
    });

    it("loads the runtime bundle on first bundle command", async () => {
        const readyPromise = waitForMessage(hostWindow, "runtime-ready", 2000);
        runtime.updateBundle(SYNTHETIC_RUNTIME_BUNDLE);
        const msg = await readyPromise;
        expect(msg.type).toBe("runtime-ready");

        const iframeWin = runtime.getContentWindow() as any;
        expect(typeof iframeWin.__handleCommand).toBe("function");
    });

    it("routes subsequent bundle commands to __handleCommand", async () => {
        // Load runtime
        const ready = waitForMessage(hostWindow, "runtime-ready", 2000);
        runtime.updateBundle(SYNTHETIC_RUNTIME_BUNDLE);
        await ready;

        const statusPromise = waitForMessage(hostWindow, "widget-status", 2000);
        runtime.updateBundle(USER_CODE_ONE_COMPONENT);
        await statusPromise;

        expect(receivedWidgetStatuses).toHaveLength(1);
        const iframeWin = runtime.getContentWindow() as any;
        expect(iframeWin.__commandLog.length).toBeGreaterThan(0);
    });

    it("sends widget-status after bundle with one component", async () => {
        const ready = waitForMessage(hostWindow, "runtime-ready", 2000);
        runtime.updateBundle(SYNTHETIC_RUNTIME_BUNDLE);
        await ready;

        const statusPromise = waitForMessage(hostWindow, "widget-status", 2000);
        runtime.updateBundle(USER_CODE_ONE_COMPONENT);
        await statusPromise;

        // Verified through runtime.ts handler (heights array)
        expect(receivedWidgetStatuses).toHaveLength(1);
        expect(receivedWidgetStatuses[0]).toHaveLength(1);
        expect(receivedWidgetStatuses[0][0]).toBe(100);
    });

    it("sends runtime-error when bundle throws", async () => {
        const ready = waitForMessage(hostWindow, "runtime-ready", 2000);
        runtime.updateBundle(SYNTHETIC_RUNTIME_BUNDLE);
        await ready;

        const errorPromise = waitForMessage(hostWindow, "runtime-error", 2000);
        runtime.updateBundle(USER_CODE_THROWS);
        await errorPromise;

        expect(receivedErrors).toHaveLength(1);
        expect(receivedErrors[0].message).toContain("intentional test error");
    });

    it("routes reflow command to __handleCommand", async () => {
        const ready = waitForMessage(hostWindow, "runtime-ready", 2000);
        runtime.updateBundle(SYNTHETIC_RUNTIME_BUNDLE);
        await ready;

        runtime.reflow(1000, [{ center: 200, height: 100 }], 1000, [{ center: 200, height: 100 }], []);

        // Give the postMessage round-trip time to process
        await new Promise((r) => setTimeout(r, 50));

        const iframeWin = runtime.getContentWindow() as any;
        expect(iframeWin.__lastReflow).toBeDefined();
        expect(iframeWin.__lastReflow.type).toBe("reflow");
        expect(iframeWin.__lastReflow.bands).toHaveLength(1);
    });

    it("routes scroll command to __handleCommand", async () => {
        const ready = waitForMessage(hostWindow, "runtime-ready", 2000);
        runtime.updateBundle(SYNTHETIC_RUNTIME_BUNDLE);
        await ready;

        runtime.scroll(42);
        await new Promise((r) => setTimeout(r, 50));

        const iframeWin = runtime.getContentWindow() as any;
        expect(iframeWin.__lastScroll).toBe(42);
    });

    it("routes reset command and clears command log", async () => {
        const ready = waitForMessage(hostWindow, "runtime-ready", 2000);
        runtime.updateBundle(SYNTHETIC_RUNTIME_BUNDLE);
        await ready;

        // Add some state first
        runtime.scroll(10);
        await new Promise((r) => setTimeout(r, 50));

        runtime.reset();
        await new Promise((r) => setTimeout(r, 50));

        const iframeWin = runtime.getContentWindow() as any;
        // reset clears __commandLog in our synthetic bundle
        expect(iframeWin.__commandLog).toHaveLength(0);
    });

    it("show-error adds visible class to error-overlay", async () => {
        const ready = waitForMessage(hostWindow, "runtime-ready", 2000);
        runtime.updateBundle(SYNTHETIC_RUNTIME_BUNDLE);
        await ready;

        runtime.showError("Something went wrong", "stack trace here");
        await new Promise((r) => setTimeout(r, 50));

        const iframeDoc = runtime.getIframe()?.contentDocument;
        const overlay = iframeDoc?.getElementById("error-overlay");
        expect(overlay?.classList.contains("visible")).toBe(true);
        expect(iframeDoc?.getElementById("error-message")?.textContent).toBe(
            "Something went wrong",
        );
    });

    it("clear-error removes visible class from error-overlay", async () => {
        const ready = waitForMessage(hostWindow, "runtime-ready", 2000);
        runtime.updateBundle(SYNTHETIC_RUNTIME_BUNDLE);
        await ready;

        runtime.showError("oops");
        await new Promise((r) => setTimeout(r, 50));

        runtime.clearError();
        await new Promise((r) => setTimeout(r, 50));

        const iframeDoc = runtime.getIframe()?.contentDocument;
        const overlay = iframeDoc?.getElementById("error-overlay");
        expect(overlay?.classList.contains("visible")).toBe(false);
    });
});
