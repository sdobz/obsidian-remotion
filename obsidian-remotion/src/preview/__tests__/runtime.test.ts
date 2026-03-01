/**
 * Runtime tests using JSDOM directly for iframe support
 */

import { JSDOM } from 'jsdom';
import {
    Runtime,
    type RuntimeDelegate,
} from "../runtime";

function createJsdomRuntimeDelegate() {
    // Create a fresh JSDOM instance with script execution enabled
    const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
        runScripts: 'dangerously',
    });
    const window = dom.window as unknown as Window;
    const document = window.document;

    const delegate: RuntimeDelegate = {
        getHostWindow() {
            return window;
        },
        prepareContainer(container: HTMLElement) {
            container.innerHTML = "";
            container.classList.add("remotion-preview-container");
        },
    };

    return {
        delegate,
        createContainer() {
            const container = document.createElement("div");
            document.body.appendChild(container);
            return container;
        },
    };
}

describe("Runtime", () => {
    it("becomes ready", async () => {
        const { delegate, createContainer } = createJsdomRuntimeDelegate();
        const runtime = new Runtime(delegate);

        const readinessEvents: number[] = [];
        runtime.setHandlers({
            onRuntimeError: () => { },
            onPlayerStatus: () => { },
            onPlayerScroll: () => { },
            onReady: () => {
                readinessEvents.push(1);
            },
        });

        await runtime.mount(createContainer());
        expect(readinessEvents).toHaveLength(1);

        await runtime.unmount();
    });

    it("executes posted bundles", async () => {
        const { delegate, createContainer } = createJsdomRuntimeDelegate();
        const runtime = new Runtime(delegate);

        const runtimeErrors: Array<{ message: string; stack: string }> = [];
        const playerStatuses: number[][] = [];

        runtime.setHandlers({
            onRuntimeError: (message: string, stack: string) => {
                runtimeErrors.push({ message, stack });
            },
            onPlayerStatus: (heights: number[]) => {
                playerStatuses.push(heights);
            },
            onPlayerScroll: () => { },
        });

        await runtime.mount(createContainer());

        const hardcodedBundle = "window.RemotionBundle = { scenes: [] }; window.parent.postMessage({ type: 'player-status', players: [{ height: 123 }] });";
        runtime.updateBundle(hardcodedBundle);

        // Wait for async iframe message processing
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(playerStatuses).toEqual([[123], []]);
        expect(runtimeErrors).toEqual([]);

        await runtime.unmount();
    });

    it("routes runtime messages to handlers", async () => {
        const { delegate, createContainer } = createJsdomRuntimeDelegate();
        const runtime = new Runtime(delegate);

        const runtimeErrors: Array<{ message: string; stack: string }> = [];
        const playerScrolls: number[] = [];

        runtime.setHandlers({
            onRuntimeError: (message: string, stack: string) => {
                runtimeErrors.push({ message, stack });
            },
            onPlayerStatus: () => { },
            onPlayerScroll: (scrollTop: number) => {
                playerScrolls.push(scrollTop);
            },
        });

        await runtime.mount(createContainer());

        runtime.scroll(42);
        expect(playerScrolls).toEqual([42]);

        runtime.updateBundle("throw new Error('boom')");
        expect(runtimeErrors).toHaveLength(1);
        expect(runtimeErrors[0].message).toContain("boom");

        await runtime.unmount();
    });
});
