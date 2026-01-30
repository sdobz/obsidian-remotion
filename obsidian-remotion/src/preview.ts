import { ItemView, WorkspaceLeaf } from "obsidian";
import iframeHtml from "./iframe.html";
import type { ScrollManager, ScrollDelegate, PixelBand } from "./scroll";

export const PREVIEW_VIEW_TYPE = "remotion-preview-view";

export interface PlayerStatus {
  height: number;
  error?: string;
}
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
      type: "iframe-ready";
    };

/** Message sent to iframe */
export type IframeCommand =
  | {
      type: "reset";
    }
  | {
      type: "reflow";
      iframeHeight: number;
      bands: PixelBand[];
    }
  | {
      type: "bundle";
      payload: string;
    }
  | {
      type: "scroll";
      scrollTop: number;
      positions: PixelBand[];
    };

export class PreviewView extends ItemView implements ScrollDelegate {
  private iframe: HTMLIFrameElement | null = null;
  private scrollManager: ScrollManager | null = null;
  private handleMessage = (event: MessageEvent) => {
    const data = event.data as PreviewMessage | undefined;
    if (!data) return;

    if (data.type === "runtime-error") {
      const message = data.error?.message ?? "Unknown runtime error";
      const stack = data.error?.stack ?? "";
      console.error("Remotion runtime error:", message, stack);
    } else if (data.type === "player-status") {
      console.log("[Preview] Received player-status:", data.players);
      // Players have rendered, update their heights and replay positioning
      this.scrollManager?.handlePlayerHeights(
        data.players.map((p) => p.height),
      );
    }
  };

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.icon = "video";
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
    });

    window.addEventListener("message", this.handleMessage);
  }

  async onClose() {
    window.removeEventListener("message", this.handleMessage);
    // ScrollManager is managed by the main plugin, don't destroy it here
    this.iframe = null;
    this.scrollManager = null;
  }

  public setScrollManager(scrollManager: ScrollManager | null): void {
    this.scrollManager = scrollManager;
  }

  onReflow(iframeHeight: number, bands: PixelBand[]): void {
    if (!this.iframe?.contentWindow) return;

    const cmd: IframeCommand = {
      type: "reflow",
      iframeHeight,
      bands,
    };
    this.iframe.contentWindow.postMessage(cmd, "*");
  }

  onScroll(scrollTop: number, positions: PixelBand[]): void {
    if (!this.iframe?.contentWindow) return;

    // Send scroll message to iframe with positions and scrollTop
    const cmd: IframeCommand = {
      type: "scroll",
      scrollTop,
      positions,
    };
    this.iframe.contentWindow.postMessage(cmd, "*");
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
    // Type checking is now handled internally by the iframe
    // Status updates are triggered by player rendering, not typecheck completion
    console.log("[Preview] Type check status:", status, errorCount);
  }

  public updateBundleStatus(
    status: "loading" | "ok" | "error",
    error?: string,
  ) {
    // Bundle status is now handled internally
    // Status updates come via player-status message when players render
    console.log("[Preview] Bundle status:", status, error);
  }

  public updateBundleOutput(code: string, runtimeModules?: Set<string>) {
    if (!this.iframe?.contentWindow) {
      console.warn("[Preview] Cannot update bundle output, iframe not ready");
      return;
    }

    // Reload dependencies if new modules are required
    if (runtimeModules && runtimeModules.size > 0) {
      this.injectDependencies(runtimeModules);
    }

    const cmd: IframeCommand = {
      type: "bundle",
      payload: code,
    };
    this.iframe.contentWindow.postMessage(cmd, "*");
  }
}
