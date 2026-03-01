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
 * Generate the iframe HTML template with embedded script.
 * The script placeholder will be replaced with the actual runtime code.
 */
function getIframeHTML(runtimeScript: string): string {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        html, body { 
            margin: 0; 
            padding: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: #1a1a1a;
            color: #fff;
        }
        
        .scroller {
            position: absolute;
            width: 100%;
            height: 100%;
        }

        #bands-scroller {
            z-index: 1;
            overflow: hidden;
        }

        #players-scroller {
            z-index: 4;
            overflow: auto;
            pointer-events: auto;
        }

        #link-overlay {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 3;
        }

        .scrollee {
            position: absolute;
            width: 100%;
        }

        #players-container > div {
            border-radius: 4px;
            opacity: 0;
        }

        #loading-screen {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #1a1a1a;
            z-index: 5000;
        }
        #loading-screen.hidden {
            display: none;
        }
    </style>
</head>
<body>
    <div id="loading-screen">
        <div>Loading...</div>
    </div>
    <div class="scroller" id="bands-scroller">
        <div class="scrollee" id="bands-container"></div>
    </div>
    <svg id="link-overlay"></svg>
    <div class="scroller" id="players-scroller">
        <div class="scrollee" id="players-container"></div>
    </div>
    <script>${runtimeScript}</script>
</body>
</html>`;
}

/**
 * Load the full runtime code (bundled obsidian-remotion/runtime)
 * This is injected into the iframe HTML template.
 * 
 * The runtime code is responsible for:
 * - Scroll synchronization between editor and players
 * - Player rendering and lifecycle
 * - Bundle execution
 * - Link overlays
 */
async function getRuntimeCode(): Promise<string> {
    // This is the bootstrap script that runs in the iframe
    // In production, this would be the bundled runtime from obsidian-remotion/runtime
    const setupRuntime = `
        (function() {
            const sendMessage = (msg) => window.parent.postMessage(msg, "*");
            
            // Set up message handler for commands from host
            window.addEventListener("message", (event) => {
                const command = event.data;
                if (!command || typeof command !== "object") return;

                // Route commands to runtime handlers
                if (window.__remoteRuntimeReady && window.__handleCommand) {
                    window.__handleCommand(command);
                }
            });
            
            // Runtime initialization
            window.__remoteRuntimeReady = true;
            window.__remoteRuntime = { modules: {} };
            
            // This handler is called for commands from the host
            window.__handleCommand = function(command) {
                console.log('[runtime] received command:', command.type);
                // Commands: bundle, scroll, reflow, reset, show-error, clear-error
                if (command.type === "bundle") {
                    // Bundle execution would happen here in the full runtime
                }
            };
            
            console.log('[runtime] Ready');
            
            // Signal that iframe is ready
            sendMessage({ type: "runtime-ready" });
        })();
    `;

    return setupRuntime;
}/**
 * Create iframe with srcdoc HTML that includes the runtime script.
 * Uses a promise to wait for the iframe-ready message instead of polling.
 * Returns a promise that resolves when the iframe signals it's ready.
 */
async function createRuntimeIFrame(
    hostWindow: Window,
    container: HTMLElement,
    onMessage: (message: RuntimeMessage) => void,
    runtimeCode: string,
): Promise<{ iframe: HTMLIFrameElement; cleanup: () => void }> {
    const iframe = hostWindow.document.createElement("iframe");
    iframe.classList.add("remotion-runtime-iframe");
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "0";
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");

    // Create a promise that resolves when iframe signals ready
    const readyPromise = new Promise<void>((resolve) => {
        const handleReady = (event: MessageEvent) => {
            const data = event.data as RuntimeMessage;
            if (data && data.type === "runtime-ready") {
                hostWindow.removeEventListener("message", handleReady);
                resolve();
            }
        };
        hostWindow.addEventListener("message", handleReady);
    });

    // Set up message handler for ongoing communication
    const handleMessage = (event: MessageEvent) => {
        const data = event.data as RuntimeMessage;
        if (!data || typeof data !== "object" || !("type" in data)) return;
        onMessage(data);
    };
    hostWindow.addEventListener("message", handleMessage);

    // Generate the iframe HTML with embedded runtime script
    const iframeHTML = getIframeHTML(runtimeCode);

    // Add iframe to DOM first
    container.appendChild(iframe);

    // For jsdom compatibility: always use document.write in test environments
    // jsdom's srcdoc support is incomplete and doesn't reliably execute scripts
    if (iframe.contentDocument) {
        const doc = iframe.contentDocument;
        doc.open();
        doc.write(iframeHTML);
        doc.close();
    } else {
        // Fallback to srcdoc if contentDocument is not available
        iframe.srcdoc = iframeHTML;
    }

    // Wait for iframe to signal it's ready
    await readyPromise;

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

        // Load the runtime code
        const runtimeCode = await getRuntimeCode();

        const { iframe, cleanup } = await createRuntimeIFrame(
            hostWindow,
            container,
            this.handleMessage,
            runtimeCode,
        );
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
