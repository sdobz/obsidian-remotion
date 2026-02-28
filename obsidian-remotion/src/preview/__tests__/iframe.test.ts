/**
 * @jest-environment jsdom
 */

import { IFrame, type IFrameDelegate } from "../iframe";

describe("IFrame", () => {
    it("posts a hardcoded bundle and handles a response message", async () => {
        const container = document.createElement("div");
        const postedMessages: Array<{ data: unknown; targetOrigin: string }> = [];

        const runtimeErrors: Array<{ message: string; stack: string }> = [];
        const playerStatuses: number[][] = [];
        const playerScrolls: number[] = [];
        const delegate: IFrameDelegate = {
            prepareContainer(el: HTMLElement) {
                el.innerHTML = "";
                el.classList.add("remotion-preview-container");
            },
            createIFrameElement(el: HTMLElement) {
                const iframeElement = document.createElement("iframe");
                iframeElement.className = "remotion-preview-iframe";
                const syntheticContentWindow = {
                    postMessage(data: unknown, targetOrigin: string) {
                        postedMessages.push({ data, targetOrigin });
                    },
                };
                Object.defineProperty(iframeElement, "contentWindow", {
                    configurable: true,
                    get() {
                        return syntheticContentWindow as any;
                    },
                });
                el.appendChild(iframeElement);
                return iframeElement;
            },
            onIFrameRuntimeError(message: string, stack: string) {
                runtimeErrors.push({ message, stack });
            },
            onIFramePlayerStatus(heights: number[]) {
                playerStatuses.push(heights);
            },
            onIFramePlayerScroll(scrollTop: number) {
                playerScrolls.push(scrollTop);
            },
        };

        const iframe = new IFrame(delegate);
        await iframe.mount(container);

        const iframeElement = container.querySelector("iframe") as HTMLIFrameElement;
        expect(iframeElement).not.toBeNull();
        expect(iframeElement.contentWindow).not.toBeNull();

        const hardcodedBundle = "window.RemotionBundle = { scenes: [] };";
        iframe.updateBundle(hardcodedBundle);

        expect(postedMessages).toHaveLength(1);
        expect(postedMessages[0]).toEqual({
            data: {
                type: "bundle",
                payload: hardcodedBundle,
            },
            targetOrigin: "*",
        });

        window.dispatchEvent(
            new MessageEvent("message", {
                data: {
                    type: "player-status",
                    players: [{ height: 123 }],
                },
            }),
        );

        expect(playerStatuses).toEqual([[123]]);
        expect(runtimeErrors).toEqual([]);
        expect(playerScrolls).toEqual([]);

        await iframe.unmount();
    });
});
