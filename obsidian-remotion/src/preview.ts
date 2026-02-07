import { ItemView, WorkspaceLeaf, MarkdownView } from "obsidian";
import iframeHtml from "./iframe.html";
import type { Band, InterpolatorSpec, NullArray } from "./editor/scroll-math";
import { ScrollDelegate, ScrollManager } from "./editor/scroll";
import type { CompilationManager } from "./toolchain/compilation";

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
  private compilationManager: CompilationManager | null = null;
  // Vault-scoped module cache - persists across file switches
  private static moduleCache: Map<string, unknown> = new Map();

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

  public setCompilationManager(compilationManager: CompilationManager | null): void {
    this.compilationManager = compilationManager;
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

  /**
   * Pre-inject all dependencies into iframe before bundle execution
   * Uses compilation manager to bundle modules at runtime
   * Fails immediately with error overlay if any module cannot be loaded
   */
  private async injectDependencies(bundledModules: Record<string, string>): Promise<void> {
    if (!this.iframe?.contentWindow) {
      return;
    }

    const deps: Record<string, unknown> = {};
    const errors: string[] = [];

    for (const moduleId of Object.keys(bundledModules)) {
      // Check cache first (vault-scoped)
      if (PreviewView.moduleCache.has(moduleId)) {
        deps[moduleId] = PreviewView.moduleCache.get(moduleId)!;
        continue;
      }

      try {
        const bundledCode = bundledModules[moduleId];
        if (!bundledCode) {
          throw new Error(`Failed to bundle module '${moduleId}'`);
        }

        // Execute the bundled code to get the module exports
        const moduleExports: any = {};
        const moduleWrapper = `
          (function() {
            const exports = {};
            const module = { exports };
            ${bundledCode};
            return module.exports || exports;
          })()
        `;

        const module = eval(moduleWrapper);
        if (module === undefined) {
          throw new Error(`Module '${moduleId}' resolved to undefined`);
        }
        deps[moduleId] = module;
        PreviewView.moduleCache.set(moduleId, module);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to load '${moduleId}': ${message}`);
        console.error(`[remotion] Failed to load module '${moduleId}':`, error);
      }
    }

    // If any required modules failed, show error overlay immediately
    if (errors.length > 0) {
      const errorMessage = `Module loading failed:\n${errors.join("\n")}`;
      this.showErrorOverlay(errorMessage);
      return;
    }

    // Inject all dependencies into iframe
    (this.iframe.contentWindow as any).__REMOTION_DEPS__ = deps;

    // Also expose require for the bundle
    (this.iframe.contentWindow as any).require = (id: string) => {
      if (deps[id] !== undefined) return deps[id];
      throw new Error(`Module not found: ${id}`);
    };
  }

  public resetForNewFile(): void {
    if (!this.iframe?.contentWindow) return;
    const cmd: IframeCommand = { type: "reset" };
    this.iframe.contentWindow.postMessage(cmd, "*");
  }

  public async updateBundleOutput(code: string, runtimeModules: Record<string, string>): Promise<void> {
    if (!this.iframe?.contentWindow) {
      console.warn("[Preview] Cannot update bundle output, iframe not ready");
      return;
    }

    // Pre-inject all dependencies before sending bundle
    await this.injectDependencies(runtimeModules);

    // Check if injection failed (error overlay would be shown)
    const deps = (this.iframe.contentWindow as any).__REMOTION_DEPS__;
    if (!deps || Object.keys(deps).length === 0) {
      console.warn("[Preview] Dependency injection failed, not sending bundle");
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
