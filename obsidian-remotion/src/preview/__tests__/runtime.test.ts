/**
 * @vitest-environment jsdom
 */

import { JSDOM } from "jsdom";
import {
    Runtime,
    type RuntimeDelegate,
    type RuntimeMessage,
} from "../runtime";
import { describe, it, expect } from "vitest";

function createJsdomRuntimeDelegate() {
    const jsdom = new JSDOM("<!DOCTYPE html><body></body>", {
        runScripts: "dangerously",
        url: "http://localhost",
    });
    const window = jsdom.window as unknown as Window;

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
        jsdom,
        window,
        createContainer() {
            const container = window.document.createElement("div");
            window.document.body.appendChild(container);
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

        // Wait for the iframe script to emit runtime-ready
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(readinessEvents).toHaveLength(1);

        await runtime.unmount();
    });

    it("executes posted bundles", async () => {
        const { delegate, createContainer } = createJsdomRuntimeDelegate();
        const runtime = new Runtime(delegate);

        const runtimeErrors: Array<{ message: string; stack: string }> = [];
        const playerStatuses: number[][] = [];
        const readyEvents: number[] = [];

        runtime.setHandlers({
            onRuntimeError: (message: string, stack: string) => {
                runtimeErrors.push({ message, stack });
            },
            onPlayerStatus: (heights: number[]) => {
                playerStatuses.push(heights);
            },
            onPlayerScroll: () => { },
            onReady: () => {
                readyEvents.push(1);
            },
        });

        await runtime.mount(createContainer());

        // Wait for runtime-ready
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(readyEvents).toHaveLength(1);

        // Execute a bundle - iframe will respond with player-status
        runtime.updateBundle("window.RemotionBundle = { players: [{ height: 123 }] };");
        await new Promise(resolve => setTimeout(resolve, 50));

        // Execute another bundle
        runtime.updateBundle("window.RemotionBundle = { players: [] };");
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(playerStatuses).toHaveLength(2);
        expect(playerStatuses[0]).toEqual([]);
        expect(playerStatuses[1]).toEqual([]);
        expect(runtimeErrors).toEqual([]);

        await runtime.unmount();
    });

    it("routes runtime messages to handlers", async () => {
        const { delegate, createContainer } = createJsdomRuntimeDelegate();
        const runtime = new Runtime(delegate);

        const runtimeErrors: Array<{ message: string; stack: string }> = [];
        const playerScrolls: number[] = [];
        const readyEvents: number[] = [];

        runtime.setHandlers({
            onRuntimeError: (message: string, stack: string) => {
                runtimeErrors.push({ message, stack });
            },
            onPlayerStatus: () => { },
            onPlayerScroll: (scrollTop: number) => {
                playerScrolls.push(scrollTop);
            },
            onReady: () => {
                readyEvents.push(1);
            },
        });

        await runtime.mount(createContainer());

        // Wait for runtime-ready
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(readyEvents).toHaveLength(1);

        // Trigger scroll - iframe echoes it back as player-scroll
        runtime.scroll(42);
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(playerScrolls).toEqual([42]);

        // Execute a bundle with an error
        runtime.updateBundle("throw new Error('boom');");
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(runtimeErrors).toHaveLength(1);
        expect(runtimeErrors[0].message).toContain("boom");

        await runtime.unmount();
    });
});
