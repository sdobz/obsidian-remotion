import type { Band, InterpolatorSpec, NullArray } from "obsidian-remotion-runtime";

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
 * Create the runtime DOM structure (bands, players, overlay) in a target document.
 * This is used by both iframe and inline mounting modes.
 */
function createRuntimeDOMStructure(doc: Document): void {
    const style = doc.createElement("style");
    style.textContent = `
        html, body { margin: 0; width: 100%; height: 100%; background: #000; overflow: hidden; }
        #bands-scroller { position: absolute; top: 0; left: 0; right: 0; bottom: 0; }
        #players-scroller { position: absolute; top: 0; left: 0; right: 0; bottom: 0; }
        #link-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
    `;
    doc.head.appendChild(style);

    const bandsScroller = doc.createElement("div");
    bandsScroller.id = "bands-scroller";
    const bandsContainer = doc.createElement("div");
    bandsContainer.id = "bands-container";
    bandsScroller.appendChild(bandsContainer);

    const linkOverlay = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    linkOverlay.id = "link-overlay";

    const playersScroller = doc.createElement("div");
    playersScroller.id = "players-scroller";
    const playersContainer = doc.createElement("div");
    playersContainer.id = "players-container";
    playersScroller.appendChild(playersContainer);

    doc.body.appendChild(bandsScroller);
    doc.body.appendChild(linkOverlay);
    doc.body.appendChild(playersScroller);
}

/**
 * Create iframe with DOM-based runtime setup (no srcdoc strings).
 */
function createRuntimeIFrame(
    hostWindow: Window,
    container: HTMLElement,
    onMessage: (message: RuntimeMessage) => void,
): { iframe: HTMLIFrameElement; cleanup: () => void } {
    const iframe = hostWindow.document.createElement("iframe");
    iframe.classList.add("remotion-runtime-iframe");
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "0";
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
    container.appendChild(iframe);

    // Wait for contentDocument to be available (jsdom may need this)
    let iframeDoc = iframe.contentDocument;
    if (!iframeDoc && iframe.contentWindow) {
        iframeDoc = iframe.contentWindow.document;
    }
    if (!iframeDoc) throw new Error("iframe contentDocument unavailable");

    // Build runtime DOM structure directly
    iframeDoc.open();
    iframeDoc.write("<!doctype html><html><head><meta charset='utf-8'/></head><body></body></html>");
    iframeDoc.close();

    // Create runtime DOM structure
    createRuntimeDOMStructure(iframeDoc);

    // Setup message handling inside iframe
    const iframeWindow = iframe.contentWindow!;
    const script = iframeDoc.createElement("script");
    script.textContent = `
        (() => {
            const emit = (message) => window.parent.postMessage(message, "*");
            const executeBundle = (payload) => {
                try {
                    const fn = new Function("window", payload);
                    fn(window);
                    if (window.RemotionBundle) {
                        emit({ type: "player-status", players: [] });
                    }
                } catch (error) {
                    emit({
                        type: "runtime-error",
                        error: {
                            message: error?.message ?? "Unknown runtime error",
                            stack: error?.stack ?? "",
                        },
                    });
                }
            };

            window.addEventListener("message", (event) => {
                const command = event.data;
                if (!command || typeof command !== "object") return;

                if (command.type === "bundle") {
                    executeBundle(command.payload);
                    return;
                }

                if (command.type === "scroll") {
                    emit({ type: "player-scroll", playerScrollTop: command.editorScrollTop });
                }
            });

            emit({ type: "runtime-ready" });
        })();
    `;
    iframeDoc.body.appendChild(script);

    // Listen for messages from iframe
    const handleMessage = (event: MessageEvent) => {
        // In jsdom, event.source may not be strictly equal to iframeWindow
        // Check if it's from any iframe or if data has the expected shape
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
        const { iframe, cleanup } = createRuntimeIFrame(hostWindow, container, this.handleMessage);
        this.iframe = iframe;
        this.cleanup = cleanup;
    } public async unmount(): Promise<void> {
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
