import type { Band, InterpolatorSpec, NullArray } from "obsidian-remotion-runtime";
import iframeHTML from "./iframe.html";

export type RuntimeMessage =
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
        type: "runtime-ready";
    };

export type RuntimeCommand =
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

export interface RuntimeDelegate {
    getHostWindow(): Window;
    prepareContainer(container: HTMLElement): void;
}

/**
 * Create iframe with HTML that includes the bootstrap and bundle execution code.
 * Uses document.write for jsdom compatibility and srcdoc for browser environments.
 * Returns a promise that resolves when the iframe signals it's ready via postMessage.
 */
async function createRuntimeIFrame(
    hostWindow: Window,
    container: HTMLElement,
    onMessage: (message: RuntimeMessage) => void,
): Promise<{ iframe: HTMLIFrameElement; cleanup: () => void }> {
    const iframe = hostWindow.document.createElement("iframe");
    iframe.classList.add("remotion-runtime-iframe");
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "0";
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");

    // Add iframe to DOM first
    container.appendChild(iframe);

    // Create a promise that resolves when iframe signals ready
    const readyPromise = new Promise<void>((resolve) => {
        const handleReady = (event: MessageEvent) => {
            const data = event.data as RuntimeMessage;
            if (data && data.type === "runtime-ready") {
                hostWindow.removeEventListener("message", handleReady);
                // Call onMessage so handlers get the ready message
                onMessage(data);
                resolve();
            }
        };
        hostWindow.addEventListener("message", handleReady);
    });

    // Write HTML to iframe using document.write for jsdom compatibility
    // jsdom's srcdoc support doesn't reliably execute scripts
    const iframeDoc = iframe.contentDocument;
    if (iframeDoc) {
        iframeDoc.open();
        iframeDoc.write(iframeHTML);
        iframeDoc.close();
    } else {
        // Fallback to srcdoc if contentDocument is not available
        iframe.srcdoc = iframeHTML;
    }

    // Wait for iframe to signal it's ready
    await readyPromise;

    // Set up message handler for ongoing communication
    const handleMessage = (event: MessageEvent) => {
        const data = event.data as RuntimeMessage;
        if (!data || typeof data !== "object" || !("type" in data)) return;
        onMessage(data);
    };

    hostWindow.addEventListener("message", handleMessage);

    const cleanup = () => {
        hostWindow.removeEventListener("message", handleMessage);
        iframe.remove();
    };

    return { iframe, cleanup };
}


export class Runtime {
    private delegate: RuntimeDelegate;
    private iframe: HTMLIFrameElement | null = null;
    private cleanup: (() => void) | null = null;

    constructor(delegate: RuntimeDelegate) {
        this.delegate = delegate;
    }

    public async mount(container: HTMLElement): Promise<void> {
        this.delegate.prepareContainer(container);
        const hostWindow = this.delegate.getHostWindow();

        const { iframe, cleanup } = await createRuntimeIFrame(
            hostWindow,
            container,
            this.handleMessage,
        );
        this.iframe = iframe;
        this.cleanup = cleanup;
    }

    public async unmount(): Promise<void> {
        if (this.cleanup) {
            this.cleanup();
            this.cleanup = null;
        }
        this.iframe = null;
    }

    private handleMessage = (data: RuntimeMessage) => {
        if (data.type === "runtime-error") {
            const message = data.error?.message ?? "Unknown runtime error";
            const stack = data.error?.stack ?? "";
            this.onRuntimeError(message, stack);
        } else if (data.type === "player-status") {
            this.onPlayerStatus(data.players.map((player) => player.height));
        } else if (data.type === "player-scroll") {
            this.onPlayerScroll(data.playerScrollTop);
        } else if (data.type === "runtime-ready") {
            this.onReady();
        }
    };

    private onRuntimeError(_message: string, _stack: string): void { }

    private onPlayerStatus(_heights: number[]): void { }

    private onPlayerScroll(_scrollTop: number): void { }

    private onReady(): void { }

    public setHandlers(handlers: {
        onRuntimeError: (message: string, stack: string) => void;
        onPlayerStatus: (heights: number[]) => void;
        onPlayerScroll: (scrollTop: number) => void;
        onReady?: () => void;
    }): void {
        this.onRuntimeError = handlers.onRuntimeError;
        this.onPlayerStatus = handlers.onPlayerStatus;
        this.onPlayerScroll = handlers.onPlayerScroll;
        this.onReady = handlers.onReady ?? (() => { });
    }

    public getContentWindow(): Window | null {
        return this.iframe?.contentWindow ?? null;
    }

    private postCommand(command: RuntimeCommand): void {
        this.iframe?.contentWindow?.postMessage(command, "*");
    }

    public updateBundle(code: string): void {
        this.postCommand({ type: "bundle", payload: code });
    }

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

    public scroll(editorScrollTop: number): void {
        this.postCommand({ type: "scroll", editorScrollTop });
    }

    public reset(): void {
        this.postCommand({ type: "reset" });
    }

    public showError(message: string, stack?: string): void {
        this.postCommand({ type: "show-error", message, stack });
    }

    public clearError(): void {
        this.postCommand({ type: "clear-error" });
    }
}
