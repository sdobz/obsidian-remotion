import { ItemView, WorkspaceLeaf, MarkdownView } from "obsidian";
import iframeHtml from "./iframe.html";
import {
  ScrollManager,
  ScrollDelegate,
  ViewportState,
  PixelBand,
  PlayerPosition,
} from "./scroll";
import { getEditorView } from "./editor";
import type { PreviewSpan } from "remotion-md";
import { StatusInfo } from "./ui";

export const PREVIEW_VIEW_TYPE = "remotion-preview-view";

type StatusCallback = (typecheck: StatusInfo, bundle: StatusInfo) => void;

/** Message received from iframe */
export type PreviewMessage =
  | {
      type: "runtime-error";
      error?: { message?: string; stack?: string };
    }
  | {
      type: "status-update";
      typecheck: StatusInfo;
      bundle: StatusInfo;
    }
  | {
      type: "players-rendered";
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
      type: "typecheck-status";
      status: "loading" | "ok" | "error";
      errorCount?: number;
    }
  | {
      type: "bundle-status";
      status: "loading" | "ok" | "error";
      error?: string;
    }
  | {
      type: "bundle-output";
      payload: string;
      previewLocations: Array<Record<string, unknown>>;
    }
  | {
      type: "viewport-sync";
      scrollTop: number;
    };

export class PreviewView extends ItemView implements ScrollDelegate {
  private iframe: HTMLIFrameElement | null = null;
  private statusCallback: StatusCallback | null = null;
  private scrollManager: ScrollManager | null = null;
  private handleMessage = (event: MessageEvent) => {
    const data = event.data as PreviewMessage | undefined;
    if (!data) return;

    if (data.type === "runtime-error") {
      const message = data.error?.message ?? "Unknown runtime error";
      const stack = data.error?.stack ?? "";
      console.error("Remotion runtime error:", message, stack);
    } else if (data.type === "status-update") {
      this.statusCallback?.(data.typecheck, data.bundle);
    } else if (data.type === "players-rendered") {
      console.log("[Preview] Received players-rendered message");
      // Replay stored semantic locations when players are rendered
      if (this.ensureScrollManager()) {
        this.scrollManager!.replayPreviewSpans();
      }
    }
  };

  constructor(leaf: WorkspaceLeaf, statusCallback: StatusCallback) {
    super(leaf);
    this.icon = "video";
    this.statusCallback = statusCallback;
  }

  getViewType(): string {
    return PREVIEW_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Remotion Preview";
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("remotion-preview-container");
    console.log("[Preview] Opening Remotion Preview View");

    // Create iframe for Remotion runtime
    this.iframe = container.createEl("iframe", {
      cls: "remotion-preview-iframe",
    });
    this.iframe.style.width = "100%";
    this.iframe.style.height = "100%";
    this.iframe.style.border = "none";
    this.iframe.style.backgroundColor = "#000";

    // Load iframe HTML from bundled file
    this.iframe.srcdoc = iframeHtml;

    this.iframe.addEventListener("load", () => {
      this.injectDependencies();
      console.log("[Preview] Iframe loaded, deferring ScrollManager init");
      // ScrollManager will be initialized lazily when first needed
      this.ensureScrollManager();
    });

    window.addEventListener("message", this.handleMessage);
  }

  async onClose() {
    window.removeEventListener("message", this.handleMessage);
    if (this.scrollManager) {
      this.scrollManager.destroy();
    }
    this.iframe = null;
    this.statusCallback = null;
    this.scrollManager = null;
  }

  private ensureScrollManager(): boolean {
    // If ScrollManager already exists, we're good
    if (this.scrollManager) return true;

    // Try to initialize ScrollManager if we have an active markdown view and iframe
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView || !this.iframe) return false;

    const editorView = getEditorView(activeView);
    const scrollDOM = editorView?.scrollDOM;
    const container = activeView.leaf.view.containerEl;

    if (scrollDOM && editorView) {
      console.log("[Preview] Initializing ScrollManager");
      this.scrollManager = new ScrollManager(
        scrollDOM,
        container,
        editorView,
        this,
      );
      return true;
    }

    return false;
  }

  /**
   * ScrollDelegate implementation: Handle viewport state changes from ScrollManager
   */
  onViewportSync(state: ViewportState): void {
    if (!this.iframe?.contentWindow) return;

    // Set iframe height to match viewport
    this.iframe.style.height = `${state.iframeHeight}px`;

    // Send viewport-sync message to iframe
    const cmd: IframeCommand = {
      type: "viewport-sync",
      scrollTop: state.scrollTop,
    };
    this.iframe.contentWindow.postMessage(cmd, "*");
  }

  /**
   * ScrollDelegate implementation: Handle preview bands update from ScrollManager
   */
  onPreviewBandsUpdate(bands: PixelBand[]): void {
    if (!this.iframe?.contentWindow) return;
    // Send preview bands as part of viewport update
    console.log("[Preview] Preview bands updated:", bands.length);
  }

  /**
   * ScrollDelegate implementation: Handle player positions update from ScrollManager
   */
  onPlayerPositionsUpdate(positions: PlayerPosition[]): void {
    if (!this.iframe?.contentWindow) return;
    const playersContainer =
      this.iframe.contentWindow.document.getElementById("players");
    if (!playersContainer) return;

    const playerElements = Array.from(
      playersContainer.children,
    ) as HTMLElement[];

    positions.forEach((pos) => {
      const element = playerElements[pos.index];
      if (element) {
        element.style.position = "absolute";
        element.style.top = `${Math.max(0, pos.actualOffset)}px`;
        element.style.left = "0";
        element.style.right = "0";
      }
    });

    // Update container sizing
    playersContainer.style.position = "relative";
    const maxBottom = Math.max(
      ...positions.map((p) => p.actualOffset + p.height),
      0,
    );
    if (maxBottom > 0) {
      playersContainer.style.minHeight = `${maxBottom + 20}px`;
    }
  }

  /**
   * Send viewport sync message to iframe (delegated from ScrollManager)
   */
  private sendViewportSync(
    state: ReturnType<ScrollManager["getViewportState"]>,
  ): void {
    if (!this.iframe?.contentWindow) return;
    const cmd: IframeCommand = {
      type: "viewport-sync",
      scrollTop: state.scrollTop,
    };
    this.iframe.contentWindow.postMessage(cmd, "*");
  }

  /**
   * Update preview bands in iframe (delegated from ScrollManager)
   */
  private updatePreviewBands(
    bands: Array<{ topOffset: number; height: number }>,
  ): void {
    if (!this.iframe?.contentWindow) return;
    // Send preview bands as part of viewport update
    console.log("[Preview] Preview bands updated:", bands.length);
  }

  /**
   * Update player positions in iframe (delegated from ScrollManager)
   */
  private updatePlayerPositions(
    positions: Array<{ index: number; actualOffset: number; height: number }>,
  ): void {
    if (!this.iframe?.contentWindow) return;
    const playersContainer =
      this.iframe.contentWindow.document.getElementById("players");
    if (!playersContainer) return;

    const playerElements = Array.from(
      playersContainer.children,
    ) as HTMLElement[];

    positions.forEach((pos) => {
      const element = playerElements[pos.index];
      if (element) {
        element.style.position = "absolute";
        element.style.top = `${Math.max(0, pos.actualOffset)}px`;
        element.style.left = "0";
        element.style.right = "0";
      }
    });

    // Update container sizing
    playersContainer.style.position = "relative";
    const maxBottom = Math.max(
      ...positions.map((p) => p.actualOffset + p.height),
      0,
    );
    if (maxBottom > 0) {
      playersContainer.style.minHeight = `${maxBottom + 20}px`;
    }
  }

  private injectDependencies(requiredModules?: Set<string>) {
    if (!this.iframe?.contentWindow) {
      return;
    }

    try {
      let req: ((id: string) => unknown) | undefined;
      try {
        const { createRequire } = require("module");
        const adapter = this.app.vault.adapter as any;
        if (adapter && typeof adapter.getBasePath === "function") {
          const basePath = adapter.getBasePath();
          const vaultRoot =
            basePath && basePath.startsWith("app://")
              ? basePath.replace(/^app:\/\/[^\/]+/, "")
              : basePath;
          if (vaultRoot) {
            const anchor = require("path").join(vaultRoot, "package.json");
            req = createRequire(anchor);
          }
        }
      } catch (e) {
        // Silently fail if createRequire is unavailable
      }

      if (!req) {
        const winReq = (window as any).require;
        if (typeof winReq === "function") req = winReq;
      }

      if (typeof req === "function") {
        // Set up __REMOTION_DEPS__ object with all dependencies
        const deps: any = {};

        // Always try to load core dependencies
        const coreModules = [
          "react",
          "react/jsx-runtime",
          "remotion",
          "react-dom",
          "react-dom/client",
          "@remotion/player",
        ];

        // Add any additional runtime modules if specified
        if (requiredModules) {
          for (const mod of requiredModules) {
            if (!coreModules.includes(mod)) {
              coreModules.push(mod);
            }
          }
        }

        // Try to load each module
        for (const modName of coreModules) {
          try {
            deps[modName] = req(modName);
          } catch (e) {
            // Silently ignore missing modules
          }
        }

        (this.iframe.contentWindow as any).__REMOTION_DEPS__ = deps;
      }
    } catch (e) {
      console.debug("Dependency injection failed:", e);
    }
  }

  public resetForNewFile() {
    if (!this.iframe?.contentWindow) return;
    const cmd: IframeCommand = { type: "reset" };
    this.iframe.contentWindow.postMessage(cmd, "*");
  }

  public updateTypeCheckStatus(
    status: "loading" | "ok" | "error",
    errorCount?: number,
  ) {
    if (!this.iframe?.contentWindow) return;
    const cmd: IframeCommand = {
      type: "typecheck-status",
      status,
      errorCount,
    };
    this.iframe.contentWindow.postMessage(cmd, "*");
  }

  public updateBundleStatus(
    status: "loading" | "ok" | "error",
    error?: string,
  ) {
    if (!this.iframe?.contentWindow) return;
    const cmd: IframeCommand = {
      type: "bundle-status",
      status,
      error,
    };
    this.iframe.contentWindow.postMessage(cmd, "*");
  }

  public updateBundleOutput(
    code: string,
    previewLocations: PreviewSpan[],
    runtimeModules?: Set<string>,
  ) {
    if (!this.iframe?.contentWindow) return;

    // Reload dependencies if new modules are required
    if (runtimeModules && runtimeModules.size > 0) {
      this.injectDependencies(runtimeModules);
    }

    // Ensure ScrollManager is initialized before using it
    if (this.ensureScrollManager()) {
      this.scrollManager!.handlePreviewSpans(previewLocations);
    }

    const cmd: IframeCommand = {
      type: "bundle-output",
      payload: code,
      previewLocations: [],
    };
    this.iframe.contentWindow.postMessage(cmd, "*");
  }
}
