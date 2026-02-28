import {
  ItemView,
  WorkspaceLeaf,
  MarkdownView,
  normalizePath,
  TFile,
} from "obsidian";
import path from "path";
import iframeHtml from "./iframe.html";
import type { Band, InterpolatorSpec, NullArray } from "obsidian-remotion-runtime";
import { ScrollDelegate, ScrollManager } from "../editor/scroll";
import { FileResolver, getMimeType, shimWindow } from "./vault-fetch";

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

  private createStaticFileResolver(): FileResolver {
    const app = this.app;
    return (filePath: string) => {
      if (!filePath || typeof filePath !== "string") {
        return { kind: "url", url: String(filePath) };
      }

      const activeView = app.workspace.getActiveViewOfType(MarkdownView);
      const activePath = activeView?.file?.path || "";
      let resolvedPath = filePath;

      if (!filePath.startsWith("/") && activePath) {
        const baseDir = path.posix.dirname(activePath);
        resolvedPath = normalizePath(path.posix.join(baseDir, filePath));
      } else {
        resolvedPath = normalizePath(filePath.replace(/^\//, ""));
      }

      const file = app.vault.getAbstractFileByPath(resolvedPath);
      if (file instanceof TFile) {
        return {
          kind: "vault",
          file,
          size: file.stat.size,
          mimeType: getMimeType(file.extension),
        };
      }

      return { kind: "url", url: filePath };
    };
  }

  public resetForNewFile(): void {
    if (!this.iframe?.contentWindow) return;
    const cmd: IframeCommand = { type: "reset" };
    this.iframe.contentWindow.postMessage(cmd, "*");
  }

  public async updateBundleOutput(code: string): Promise<void> {
    if (!this.iframe?.contentWindow) {
      console.warn("[Preview] Cannot update bundle output, iframe not ready");
      return;
    }

    // Shim window for vault file access
    const iframeWindow = this.iframe.contentWindow as any;
    shimWindow(
      iframeWindow,
      this.createStaticFileResolver(),
      this.app.vault.readBinary.bind(this.app.vault),
    );

    const cmd: IframeCommand = {
      type: "bundle",
      payload: code,
    };
    this.iframe.contentWindow.postMessage(cmd, "*");
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
