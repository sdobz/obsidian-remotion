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

/**
 * Utility to wait for a specific message type.
 * Returns a promise that resolves when the message is received.
 */
function createMessageWaiter() {
    let pendingWaits: Array<{
        messageType: string;
        resolve: (msg: RuntimeMessage) => void;
        reject: (err: Error) => void;
        timeout: NodeJS.Timeout;
    }> = [];

    const handler = (msg: RuntimeMessage) => {
        // Notify all waiters for this message type
        const index = pendingWaits.findIndex((w) => w.messageType === msg.type);
        if (index !== -1) {
            const [waiter] = pendingWaits.splice(index, 1);
            clearTimeout(waiter.timeout);
            waiter.resolve(msg);
        }
    };

    const waitFor = <T extends RuntimeMessage["type"]>(
        messageType: T,
        timeoutMs: number = 1000,
    ): Promise<RuntimeMessage> => {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                const index = pendingWaits.findIndex((w) => w.messageType === messageType);
                if (index !== -1) {
                    pendingWaits.splice(index, 1);
                }
                reject(new Error(`Timeout waiting for message: ${messageType}`));
            }, timeoutMs);

            pendingWaits.push({
                messageType,
                resolve,
                reject,
                timeout,
            });
        });
    };

    return { handler, waitFor };
}

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

        let readyFired = false;
        runtime.setHandlers({
            onRuntimeError: () => { },
            onPlayerStatus: () => { },
            onPlayerScroll: () => { },
            onReady: () => {
                readyFired = true;
            },
        });

        await runtime.mount(createContainer());

        // The mount completes when runtime-ready is received
        expect(readyFired).toBe(true);

        await runtime.unmount();
    });

    it("executes posted bundles", async () => {
        const { delegate, createContainer, window: hostWindow } = createJsdomRuntimeDelegate();
        const runtime = new Runtime(delegate);
        const { handler, waitFor } = createMessageWaiter();

        const playerStatuses: number[][] = [];

        runtime.setHandlers({
            onRuntimeError: () => { },
            onPlayerStatus: (heights: number[]) => {
                playerStatuses.push(heights);
                handler({ type: "player-status", players: [] });
            },
            onPlayerScroll: () => { },
            onReady: () => {
                // Just flag that we're ready, don't need to handler() it
            },
        });

        await runtime.mount(createContainer());

        // Execute a bundle
        runtime.updateBundle("window.RuntimeBundle = { players: [{ height: 123 }] };");
        await waitFor("player-status");

        // Execute another bundle
        runtime.updateBundle("window.RuntimeBundle = { players: [] };");
        await waitFor("player-status");

        expect(playerStatuses).toHaveLength(2);
        expect(playerStatuses[0]).toEqual([]);
        expect(playerStatuses[1]).toEqual([]);

        await runtime.unmount();
    });

    it("routes runtime messages to handlers", async () => {
        const { delegate, createContainer, window: hostWindow } = createJsdomRuntimeDelegate();
        const runtime = new Runtime(delegate);
        const { handler, waitFor } = createMessageWaiter();

        const runtimeErrors: Array<{ message: string; stack: string }> = [];

        runtime.setHandlers({
            onRuntimeError: (message: string, stack: string) => {
                runtimeErrors.push({ message, stack });
                handler({ type: "runtime-error", error: { message, stack } });
            },
            onPlayerStatus: () => { },
            onPlayerScroll: () => { },
            onReady: () => {
                // Runtime is ready
            },
        });

        await runtime.mount(createContainer());

        // Execute a bundle with an error
        runtime.updateBundle("throw new Error('boom');");
        const errorMsg = await waitFor("runtime-error");
        expect(errorMsg.type).toBe("runtime-error");
        expect(runtimeErrors).toHaveLength(1);
        expect(runtimeErrors[0].message).toContain("boom");

        await runtime.unmount();
    });
});