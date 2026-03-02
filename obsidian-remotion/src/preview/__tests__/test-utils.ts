/**
 * Shared test utilities for Runtime and bundling integration tests
 */

import { JSDOM } from "jsdom";
import { Runtime, type RuntimeDelegate, type RuntimeMessage } from "../runtime";
import { BundlePipeline, loadEsbuild, ResolutionContext } from "remotion-md";
import path from "path";

/**
 * Message waiter utility for Runtime tests
 */
export function createMessageWaiter() {
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
export function createJsdomRuntimeDelegate() {
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

/**
 * Create runtime with handlers and return test utilities
 */
export interface RuntimeTestContext {
    runtime: Runtime;
    waitFor: ReturnType<typeof createMessageWaiter>["waitFor"];
    runtimeErrors: Array<{ message: string; stack: string }>;
    playerStatuses: number[][];
    container: HTMLElement;
}

export async function setupRuntimeTest(): Promise<RuntimeTestContext> {
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

    const container = createContainer();
    await runtime.mount(container);

    return {
        runtime,
        waitFor,
        runtimeErrors,
        playerStatuses,
        container,
    };
}

/**
 * Bundle markdown using BundlePipeline
 */
export interface BundleOptions {
    markdown: string;
    notePath?: string;
    esbuildInstance: any;
    examplesDir?: string;
}

export async function bundleMarkdown(options: BundleOptions) {
    const {
        markdown,
        notePath = "Test.md",
        esbuildInstance,
        examplesDir = path.resolve(__dirname, "../../../../examples"),
    } = options;

    const pipeline = new BundlePipeline();
    const absoluteNotePath = path.join(examplesDir, notePath);
    const resolutionContext = new ResolutionContext(examplesDir, absoluteNotePath);

    const result = await pipeline.process({
        markdown,
        notePath,
        absoluteNotePath,
        resolutionContext,
        esbuildInstance,
    });

    return result;
}

/**
 * Initialize esbuild instance for tests
 */
export function initializeEsbuild() {
    const examplesDir = path.resolve(__dirname, "../../../../examples");
    const rootDir = path.resolve(__dirname, "../../../../");

    const nodeModulesPaths = [
        path.join(examplesDir, "node_modules"),
        path.join(rootDir, "node_modules"),
    ];

    const esbuildInstance = loadEsbuild(nodeModulesPaths);

    if (!esbuildInstance) {
        throw new Error("esbuild not found in examples/node_modules or root node_modules");
    }

    return { esbuildInstance, examplesDir, rootDir };
}

/**
 * Wait for runtime to process bundle and return result
 */
export async function executeBundle(
    ctx: RuntimeTestContext,
    bundleCode: string,
    timeoutMs: number = 10000,
): Promise<{ success: boolean; error?: { message: string; stack: string } }> {
    ctx.runtime.updateBundle(bundleCode);

    const response = await Promise.race([
        ctx.waitFor("player-status", timeoutMs),
        ctx.waitFor("runtime-error", timeoutMs),
    ]);

    if (response.type === "runtime-error") {
        return {
            success: false,
            error: ctx.runtimeErrors[ctx.runtimeErrors.length - 1],
        };
    }

    return { success: true };
}
