import { ItemView, WorkspaceLeaf, MarkdownView } from "obsidian";
import iframeHtml from "./iframe.html";
import type { ScrollManager, ScrollDelegate } from "./scroll";
import type { Band, InterpolatorSpec, NullArray } from "./scroll-math";

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
      type: "player-scroll";
      playerScrollTop: number;
    }
  | {
      type: "request-module";
      id: string;
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

export class PreviewView extends ItemView implements ScrollDelegate {
  private iframe: HTMLIFrameElement | null = null;
  private scrollManager: ScrollManager | null = null;
  private moduleCache: Map<string, unknown> = new Map();

  private handleMessage = (event: MessageEvent) => {
    const data = event.data as PreviewMessage | undefined;
    if (!data) return;

    if (data.type === "runtime-error") {
      const message = data.error?.message ?? "Unknown runtime error";
      const stack = data.error?.stack ?? "";
      console.error("Remotion runtime error:", message, stack);
    } else if (data.type === "player-status") {
      // Players have rendered, update their heights and replay positioning
      this.scrollManager?.handlePlayerHeights(
        data.players.map((p) => p.height),
      );
    } else if (data.type === "player-scroll") {
      // Player container was scrolled, map back to editor scroll
      this.scrollManager?.handlePlayerScroll(data.playerScrollTop);
    } else if (data.type === "request-module") {
      // Iframe is requesting a module - try to load and send it back
      this.handleModuleRequest(data.id);
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

  onReflow(
    bandScrollHeight: number,
    bands: NullArray<Band>,
    playerScrollHeight: number,
    players: NullArray<Band>,
    interpolatorSpecs: InterpolatorSpec[],
  ): void {
    if (!this.iframe?.contentWindow) return;

    const cmd: IframeCommand = {
      type: "reflow",
      bandScrollHeight,
      bands,
      playerScrollHeight,
      players,
      interpolatorSpecs,
    };
    this.iframe.contentWindow.postMessage(cmd, "*");
  }

  onScroll(editorScrollTop: number): void {
    if (!this.iframe?.contentWindow) return;

    const cmd: IframeCommand = {
      type: "scroll",
      editorScrollTop,
    };
    this.iframe.contentWindow.postMessage(cmd, "*");
  }

  private injectDependencies() {
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

      if (!req && typeof require === "function") {
        req = require;
      }

      if (typeof req === "function") {
        // Store the require function for use in handleModuleRequest
        this.requireFn = req;

        // Set up __REMOTION_DEPS__ object - initial deps will be populated on demand
        (this.iframe.contentWindow as any).__REMOTION_DEPS__ =
          (this.iframe.contentWindow as any).__REMOTION_DEPS__ || {};
      }
    } catch (e) {
      console.debug("Dependency injection failed:", e);
    }
  }

  private requireFn: ((id: string) => unknown) | undefined;

  private handleModuleRequest(moduleId: string): void {
    if (!this.iframe?.contentWindow) return;

    // Check cache first
    if (this.moduleCache.has(moduleId)) {
      const module = this.moduleCache.get(moduleId);
      this.iframe.contentWindow.postMessage(
        { type: "module-response", id: moduleId, module },
        "*",
      );
      return;
    }

    try {
      let module: unknown | undefined;

      try {
        if (this.requireFn) {
          module = this.requireFn(moduleId);
        } else {
          module = undefined;
        }
      } catch {
        const globals: Record<string, unknown> = {
          react: (window as any).React,
          "react-dom": (window as any).ReactDOM,
          "react-dom/client": (window as any).ReactDOMClient,
        };
        module = globals[moduleId];
      }

      if (module === undefined) {
        throw new Error(`Module not found: ${moduleId}`);
      }

      this.moduleCache.set(moduleId, module);
      this.iframe.contentWindow.postMessage(
        { type: "module-response", id: moduleId, module },
        "*",
      );
    } catch (error) {
      console.warn(`Failed to load module ${moduleId}:`, error);
      // Send error response
      this.iframe.contentWindow.postMessage(
        {
          type: "module-response",
          id: moduleId,
          error: `Module not found: ${moduleId}`,
        },
        "*",
      );
    }
  }

  public resetForNewFile() {
    if (!this.iframe?.contentWindow) return;
    const cmd: IframeCommand = { type: "reset" };
    this.iframe.contentWindow.postMessage(cmd, "*");
  }

  public updateBundleOutput(code: string) {
    if (!this.iframe?.contentWindow) {
      console.warn("[Preview] Cannot update bundle output, iframe not ready");
      return;
    }

    this.iframe.inert = true;

    const cmd: IframeCommand = {
      type: "bundle",
      payload: code,
    };
    this.iframe.contentWindow.postMessage(cmd, "*");

    setTimeout(() => {
      if (this.iframe) {
        this.iframe.inert = false;
      }
    }, 100);
  }

  public showErrorOverlay(message: string, stack?: string): void {
    if (!this.iframe?.contentWindow) return;
    const cmd: IframeCommand = { type: "show-error", message, stack };
    this.iframe.contentWindow.postMessage(cmd, "*");
  }

  public clearErrorOverlay(): void {
    if (!this.iframe?.contentWindow) return;
    const cmd: IframeCommand = { type: "clear-error" };
    this.iframe.contentWindow.postMessage(cmd, "*");
  }
}
