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
    prepareContainer(container: HTMLElement): void;
    mountRuntime(
        container: HTMLElement,
        onMessage: (message: RuntimeMessage) => void,
    ): Promise<MountedRuntime>;
}

export interface MountedRuntime {
    postCommand(command: RuntimeCommand): void;
    getContentWindow(): Window | null;
    unmount(): Promise<void>;
}

export interface RuntimeWindowLike {
    parent: {
        postMessage(message: RuntimeMessage): void;
    };
    RemotionBundle?: unknown;
}

export function executeBundleString(
    runtimeWindow: RuntimeWindowLike,
    payload: string,
): RuntimeMessage[] {
    const emitted: RuntimeMessage[] = [];

    const emit = (message: RuntimeMessage) => {
        emitted.push(message);
        runtimeWindow.parent.postMessage(message);
    };

    try {
        const executeBundle = new Function("window", payload);
        executeBundle(runtimeWindow);

        if (runtimeWindow.RemotionBundle) {
            emit({ type: "player-status", players: [] });
        }
    } catch (error: any) {
        emit({
            type: "runtime-error",
            error: {
                message: error?.message ?? "Unknown runtime error",
                stack: error?.stack ?? "",
            },
        });
    }

    return emitted;
}

export function createRuntimeCommandHandler(
    runtimeWindow: RuntimeWindowLike,
    emit: (message: RuntimeMessage) => void,
): (command: RuntimeCommand) => void {
    runtimeWindow.parent.postMessage = (message: RuntimeMessage) => {
        emit(message);
    };

    return (command: RuntimeCommand) => {
        if (command.type === "bundle") {
            executeBundleString(runtimeWindow, command.payload);
        } else if (command.type === "scroll") {
            emit({ type: "player-scroll", playerScrollTop: command.editorScrollTop });
        }
    };
}

export class Runtime {
    private delegate: RuntimeDelegate;
    private mountedRuntime: MountedRuntime | null = null;

    constructor(delegate: RuntimeDelegate) {
        this.delegate = delegate;
    }

    public async mount(container: HTMLElement): Promise<void> {
        this.delegate.prepareContainer(container);
        this.mountedRuntime = await this.delegate.mountRuntime(
            container,
            this.handleMessage,
        );
    }

    public async unmount(): Promise<void> {
        if (this.mountedRuntime) {
            await this.mountedRuntime.unmount();
            this.mountedRuntime = null;
        }
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
        return this.mountedRuntime?.getContentWindow() ?? null;
    }

    private postCommand(command: RuntimeCommand): void {
        this.mountedRuntime?.postCommand(command);
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
