import { ItemView, WorkspaceLeaf, MarkdownView } from "obsidian";
import iframeHtml from "./iframe.html";
import { ScrollManager, PreviewLocation } from "./ui";
import { getEditorView } from "./editor";

export const PREVIEW_VIEW_TYPE = "remotion-preview-view";

export class PreviewView extends ItemView {
  private iframe: HTMLIFrameElement | null = null;
  private statusCallback: ((typecheck: any, bundle: any) => void) | null = null;
  private scrollManager: ScrollManager | null = null;
  private handleMessage = (event: MessageEvent) => {
    const data = event.data as {
      type?: string;
      error?: { message?: string; stack?: string };
      typecheck?: { status: string; errorCount: number };
      bundle?: { status: string; error: string | null };
    };
    if (!data) return;

    if (data.type === "runtime-error") {
      const message = data.error?.message ?? "Unknown runtime error";
      const stack = data.error?.stack ?? "";
      console.error("Remotion runtime error:", message, stack);
    } else if (data.type === "status-update") {
      if (this.statusCallback) {
        this.statusCallback(data.typecheck, data.bundle);
      }
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
      // Initialize ScrollManager after iframe loads
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView && this.iframe) {
        const scrollableArea = activeView.leaf.view.containerEl;
        this.scrollManager = new ScrollManager(scrollableArea, this.iframe);
      }
    });

    window.addEventListener("message", this.handleMessage);
  }

  async onClose() {
    window.removeEventListener("message", this.handleMessage);
    this.iframe = null;
    this.statusCallback = null;
    this.scrollManager = null;
  }

  public setStatusCallback(callback: (typecheck: any, bundle: any) => void) {
    this.statusCallback = callback;
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
    this.iframe.contentWindow.postMessage({ type: "reset" }, "*");
  }

  public updateTypeCheckStatus(
    status: "loading" | "ok" | "error",
    errorCount?: number,
  ) {
    if (!this.iframe?.contentWindow) return;
    this.iframe.contentWindow.postMessage(
      {
        type: "typecheck-status",
        status,
        errorCount,
      },
      "*",
    );
  }

  public updateBundleStatus(
    status: "loading" | "ok" | "error",
    error?: string,
  ) {
    if (!this.iframe?.contentWindow) return;
    this.iframe.contentWindow.postMessage(
      {
        type: "bundle-status",
        status,
        error,
      },
      "*",
    );
  }

  public updateBundleOutput(
    code: string,
    previewLocations: Array<{
      line: number;
      column: number;
      text: string;
      options?: Record<string, any>;
      pos?: number;
      length?: number;
    }>,
    runtimeModules?: Set<string>,
  ) {
    if (!this.iframe?.contentWindow) return;

    // Reload dependencies if new modules are required
    if (runtimeModules && runtimeModules.size > 0) {
      this.injectDependencies(runtimeModules);
    }

    // Convert semantic locations to pixel offsets
    const pixelLocations = this.convertToPixelOffsets(previewLocations);

    // Update scroll manager with pixel locations
    if (this.scrollManager) {
      this.scrollManager.handlePreviewLocations(pixelLocations);
    }

    this.iframe.contentWindow.postMessage(
      {
        type: "bundle-output",
        payload: code,
        previewLocations: pixelLocations,
      },
      "*",
    );
  }

  private convertToPixelOffsets(
    locations: Array<{
      line: number;
      column: number;
      text: string;
      options?: Record<string, any>;
      pos?: number;
      length?: number;
    }>,
  ): PreviewLocation[] {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView)
      return locations.map((loc) => ({ ...loc, topOffset: 0, height: 0 }));

    const editorView = getEditorView(activeView);
    const doc = editorView?.state?.doc;
    if (!editorView || !doc) {
      return locations.map((loc) => ({ ...loc, topOffset: 0, height: 0 }));
    }

    try {
      const scrollDOM = editorView.scrollDOM;
      const scrollRect = scrollDOM.getBoundingClientRect();
      const scrollTop = scrollDOM.scrollTop || 0;
      const scrollOffset =
        activeView.leaf.view.containerEl.getBoundingClientRect().top -
        scrollRect.top;

      return locations.map((loc) => {
        try {
          const lineInfo = doc.line(loc.line);
          const pos = lineInfo.from + Math.min(loc.column, lineInfo.length);
          const coords = editorView.coordsAtPos(pos);

          if (coords) {
            const topOffset = coords.top + scrollOffset + scrollTop;
            const height = Math.max(8, coords.bottom - coords.top);
            return { ...loc, topOffset, height };
          }
        } catch (err) {
          console.warn("[remotion] Failed to convert location to pixels:", err);
        }
        return { ...loc, topOffset: 0, height: 0 };
      });
    } catch (err) {
      console.warn("[remotion] Failed to calculate pixel offsets:", err);
      return locations.map((loc) => ({ ...loc, topOffset: 0, height: 0 }));
    }
  }
}
