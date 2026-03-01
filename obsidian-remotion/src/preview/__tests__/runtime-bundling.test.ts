/**
 * @vitest-environment node
 */

import {
    BundlePipeline,
    loadEsbuild,
    ResolutionContext,
} from "remotion-md";
import path from "path";
import fs from "fs";
import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { Runtime, type RuntimeDelegate, type RuntimeMessage } from "../runtime";

/**
 * Utility to wait for a specific message type from the runtime.
 */
function createMessageWaiter() {
    let pendingWaits: Array<{
        messageType: string;
        resolve: (msg: RuntimeMessage) => void;
        reject: (err: Error) => void;
        timeout: NodeJS.Timeout;
    }> = [];

    const handler = (msg: RuntimeMessage) => {
        const index = pendingWaits.findIndex((w) => w.messageType === msg.type);
        if (index !== -1) {
            const [waiter] = pendingWaits.splice(index, 1);
            clearTimeout(waiter.timeout);
            waiter.resolve(msg);
        }
    };

    const waitFor = <T extends RuntimeMessage["type"]>(
        messageType: T,
        timeoutMs: number = 5000,
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

/**
 * Create a JSDOM-based RuntimeDelegate for testing
 */
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

describe("esbuild Bundling Integration", () => {
    const examplesDir = path.resolve(__dirname, "../../../../examples");
    const rootDir = path.resolve(__dirname, "../../../../");
    let esbuildInstance: any;

    beforeEach(() => {
        // Use the refactored loadEsbuild function with node_modules paths
        const nodeModulesPaths = [
            path.join(examplesDir, "node_modules"),
            path.join(rootDir, "node_modules"),
        ];
        esbuildInstance = loadEsbuild(nodeModulesPaths);

        if (!esbuildInstance) {
            throw new Error("esbuild not found in examples/node_modules or root node_modules");
        }
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
        const pipeline = new BundlePipeline();
        const notePath = "Test.md";
        const absoluteNotePath = path.join(examplesDir, notePath);
        const resolutionContext = new ResolutionContext(examplesDir, absoluteNotePath);

        const result = await pipeline.process({
            markdown,
            notePath,
            absoluteNotePath,
            resolutionContext,
            esbuildInstance,
        });

        expect(result.bundleStatus.status).toBe("ok");
        expect(result.bundleCode).toBeTruthy();

        // Step 2: Execute bundle through Runtime (matches PreviewView.updateBundleOutput)
        const { delegate, createContainer } = createJsdomRuntimeDelegate();
        const runtime = new Runtime(delegate);
        const { handler, waitFor } = createMessageWaiter();

        const runtimeErrors: Array<{ message: string; stack: string }> = [];
        const playerStatuses: number[][] = [];

        runtime.setHandlers({
            onRuntimeError: (message: string, stack: string) => {
                runtimeErrors.push({ message, stack });
                handler({ type: "runtime-error", error: { message, stack } });
            },
            onPlayerStatus: (heights: number[]) => {
                playerStatuses.push(heights);
                handler({ type: "player-status", players: [] });
            },
            onPlayerScroll: () => { },
            onReady: () => { },
        });

        await runtime.mount(createContainer());

        // Send bundle to runtime (matches runtime.updateBundle(code))
        runtime.updateBundle(result.bundleCode);

        // Wait for execution result
        const response = await Promise.race([
            waitFor("player-status", 10000),
            waitFor("runtime-error", 10000),
        ]);

        // Should succeed without runtime errors
        if (response.type === "runtime-error") {
            console.error("Runtime error:", runtimeErrors);
            throw new Error(`Bundle execution failed: ${runtimeErrors[0]?.message}`);
        }

        expect(response.type).toBe("player-status");
        expect(runtimeErrors).toHaveLength(0);

        // Verify bundle executed and set window.RemotionBundle in iframe
        const iframeWindow = runtime.getContentWindow();
        expect(iframeWindow).toBeTruthy();
        expect((iframeWindow as any).RemotionBundle).toBeDefined();
        expect((iframeWindow as any).RemotionBundle.MyComponent).toBeDefined();

        await runtime.unmount();
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
        const pipeline = new BundlePipeline();
        const notePath = "Test.md";
        const absoluteNotePath = path.join(examplesDir, notePath);
        const resolutionContext = new ResolutionContext(examplesDir, absoluteNotePath);

        const result = await pipeline.process({
            markdown,
            notePath,
            absoluteNotePath,
            resolutionContext,
            esbuildInstance,
        });

        // Verify bundle succeeded
        expect(result.bundleStatus.status).toBe("ok");
        expect(result.bundleCode).toBeTruthy();

        // Step 2: Execute through Runtime
        const { delegate, createContainer } = createJsdomRuntimeDelegate();
        const runtime = new Runtime(delegate);
        const { handler, waitFor } = createMessageWaiter();

        const runtimeErrors: Array<{ message: string; stack: string }> = [];

        runtime.setHandlers({
            onRuntimeError: (message: string, stack: string) => {
                runtimeErrors.push({ message, stack });
                handler({ type: "runtime-error", error: { message, stack } });
            },
            onPlayerStatus: (heights: number[]) => {
                handler({ type: "player-status", players: [] });
            },
            onPlayerScroll: () => { },
            onReady: () => { },
        });

        await runtime.mount(createContainer());

        // Send bundle to runtime
        runtime.updateBundle(result.bundleCode);

        // Wait for execution result
        const response = await Promise.race([
            waitFor("player-status", 10000),
            waitFor("runtime-error", 10000),
        ]);

        // Should succeed - React and remotion were resolved and bundled
        if (response.type === "runtime-error") {
            console.error("Runtime error:", runtimeErrors);
            throw new Error(`Dependency resolution failed: ${runtimeErrors[0]?.message}`);
        }

        expect(response.type).toBe("player-status");
        expect(runtimeErrors).toHaveLength(0);

        // Verify the bundle executed correctly in the iframe
        const iframeWindow = runtime.getContentWindow();
        expect(iframeWindow).toBeTruthy();
        expect((iframeWindow as any).RemotionBundle).toBeDefined();
        expect((iframeWindow as any).RemotionBundle.TestComponent).toBeDefined();

        await runtime.unmount();
    });
});

