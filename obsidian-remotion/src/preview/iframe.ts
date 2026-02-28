/**
 * Iframe lifecycle and messaging module
 * Manages DOM, message handling, and communication with the iframe runtime
 */

import iframeHtml from "./iframe.html";
import type { Band, InterpolatorSpec, NullArray } from "obsidian-remotion-runtime";

/** Message received from iframe */
export type PreviewMessage =
    | {
        type: "runtime-error";
        error?: { message?: string; stack?: string };
    }
    | {
        type: "player-status";
        players: PlayerStatus[];
    }
    | {
        type: "player-scroll";
        playerScrollTop: number;
    }
    | {
        type: "iframe-ready";
    };

/** Message sent to iframe */
export type IframeCommand =
    | {
        type: "reset";
    }
    | {
        type: "show-error";
        message: string;
        stack?: string;
    }
    | {
        type: "clear-error";
    }
    | {
        type: "reflow";
        bandScrollHeight: number;
        bands: NullArray<Band>;
        playerScrollHeight: number;
        players: NullArray<Band>;
        interpolatorSpecs: InterpolatorSpec[];
    }
    | {
        type: "bundle";
        payload: string;
    }
    | {
        type: "scroll";
        editorScrollTop: number;
    };

export interface PlayerStatus {
    height: number;
    error?: string;
}

/**
 * Delegate interface for iframe to communicate back to preview
 */
export interface IFrameDelegate {
    prepareContainer(container: HTMLElement): void;
    createIFrameElement(container: HTMLElement): HTMLIFrameElement;
    onIFrameRuntimeError(message: string, stack: string): void;
    onIFramePlayerStatus(heights: number[]): void;
    onIFramePlayerScroll(scrollTop: number): void;
}

/**
 * Manages iframe DOM, lifecycle, and message passing
 */
export class IFrame {
    private element: HTMLIFrameElement | null = null;
    private delegate: IFrameDelegate;

    constructor(delegate: IFrameDelegate) {
        this.delegate = delegate;
    }

    /**
     * Initialize iframe and insert into container
     */
    public async mount(container: HTMLElement): Promise<void> {
        this.delegate.prepareContainer(container);

        // Create iframe element
        this.element = this.delegate.createIFrameElement(container);
        this.element.style.width = "100%";
        this.element.style.height = "100%";
        this.element.style.border = "none";
        this.element.style.backgroundColor = "#000";

        // Load iframe HTML
        this.element.srcdoc = iframeHtml;

        // Listen for messages from iframe
        window.addEventListener("message", this.handleMessage);
    }

    /**
     * Clean up iframe and remove event listeners
     */
    public async unmount(): Promise<void> {
        window.removeEventListener("message", this.handleMessage);
        this.element = null;
    }

    /**
     * Handle message events from iframe
     */
    private handleMessage = (event: MessageEvent) => {
        const data = event.data as PreviewMessage | undefined;
        if (!data) return;

        if (data.type === "runtime-error") {
            const message = data.error?.message ?? "Unknown runtime error";
            const stack = data.error?.stack ?? "";
            this.delegate.onIFrameRuntimeError(message, stack);
        } else if (data.type === "player-status") {
            this.delegate.onIFramePlayerStatus(data.players.map((p) => p.height));
        } else if (data.type === "player-scroll") {
            this.delegate.onIFramePlayerScroll(data.playerScrollTop);
        }
    };

    /**
     * Get iframe content window for direct access (needed for shimWindow)
     */
    public getContentWindow(): Window | null {
        return this.element?.contentWindow || null;
    }

    /**
     * Send command to iframe
     */
    private postCommand(cmd: IframeCommand): void {
        if (!this.element?.contentWindow) return;
        this.element.contentWindow.postMessage(cmd, "*");
    }

    /**
     * Update user bundle in iframe
     */
    public updateBundle(code: string): void {
        this.postCommand({
            type: "bundle",
            payload: code,
        });
    }

    /**
     * Send reflow command to update player positions and scroll
     */
    public reflow(
        bandScrollHeight: number,
        bands: NullArray<Band>,
        playerScrollHeight: number,
        players: NullArray<Band>,
        interpolatorSpecs: InterpolatorSpec[],
    ): void {
        this.postCommand({
            type: "reflow",
            bandScrollHeight,
            bands,
            playerScrollHeight,
            players,
            interpolatorSpecs,
        });
    }

    /**
     * Send scroll command to sync editor scroll to iframe
     */
    public scroll(editorScrollTop: number): void {
        this.postCommand({
            type: "scroll",
            editorScrollTop,
        });
    }

    /**
     * Reset iframe for new file
     */
    public reset(): void {
        this.postCommand({
            type: "reset",
        });
    }

    /**
     * Show error overlay in iframe
     */
    public showError(message: string, stack?: string): void {
        this.postCommand({
            type: "show-error",
            message,
            stack,
        });
    }

    /**
     * Clear error overlay in iframe
     */
    public clearError(): void {
        this.postCommand({
            type: "clear-error",
        });
    }
}
