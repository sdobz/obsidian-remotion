/**
 * @jest-environment jsdom
 */

import {
    Runtime,
    executeBundleString,
    type RuntimeCommand,
    type RuntimeDelegate,
    type RuntimeMessage,
    type RuntimeWindowLike,
} from "../runtime";

function createJsdomRuntimeDelegate() {
    const commandLog: RuntimeCommand[] = [];

    const delegate: RuntimeDelegate = {
        prepareContainer(container: HTMLElement) {
            container.innerHTML = "";
            container.classList.add("remotion-preview-container");
        },
        async mountRuntime(container: HTMLElement, onMessage: (message: RuntimeMessage) => void) {
            const runtimeRoot = document.createElement("div");
            runtimeRoot.className = "runtime-root";
            container.appendChild(runtimeRoot);

            const runtimeWindow: RuntimeWindowLike = {
                parent: {
                    postMessage(message: RuntimeMessage) {
                        onMessage(message);
                    },
                },
            };

            onMessage({ type: "runtime-ready" });

            return {
                postCommand(command: RuntimeCommand) {
                    commandLog.push(command);
                    if (command.type === "bundle") {
                        executeBundleString(runtimeWindow, command.payload);
                    } else if (command.type === "scroll") {
                        onMessage({ type: "player-scroll", playerScrollTop: command.editorScrollTop });
                    }
                },
                getContentWindow() {
                    return null;
                },
                async unmount() {
                    container.innerHTML = "";
                },
            };
        },
    };

    return {
        delegate,
        commandLog,
        createContainer() {
            return document.createElement("div");
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
        const { delegate, createContainer, commandLog } = createJsdomRuntimeDelegate();
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

        expect(commandLog).toHaveLength(1);
        expect(commandLog[0]).toEqual({ type: "bundle", payload: hardcodedBundle });
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
