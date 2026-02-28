import {
  ItemView,
  WorkspaceLeaf,
  MarkdownView,
  normalizePath,
  TFile,
} from "obsidian";
import path from "path";
import type { Band, InterpolatorSpec, NullArray } from "obsidian-remotion-runtime";
import { ScrollDelegate, ScrollManager } from "../editor/scroll";
import { FileResolver, getMimeType, shimWindow } from "./vault-fetch";
import { IFrame, type IFrameDelegate } from "./iframe";

export const PREVIEW_VIEW_TYPE = "remotion-preview-view";

export class PreviewView extends ItemView implements ScrollDelegate, IFrameDelegate {
  private iframe: IFrame | null = null;
  private scrollManager: ScrollManager | null = null;

  prepareContainer(container: HTMLElement): void {
    container.innerHTML = "";
    container.classList.add("remotion-preview-container");
  }

  createIFrameElement(container: HTMLElement): HTMLIFrameElement {
    const iframe = document.createElement("iframe");
    iframe.classList.add("remotion-preview-iframe");
    container.appendChild(iframe);
    return iframe;
  }

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

    // Initialize iframe with this view as delegate
    this.iframe = new IFrame(this);
    await this.iframe.mount(container);
  }

  async onClose() {
    if (this.iframe) {
      await this.iframe.unmount();
      this.iframe = null;
    }
    this.scrollManager = null;
  }

  public setScrollManager(scrollManager: ScrollManager | null): void {
    this.scrollManager = scrollManager;
  }

  /**
   * IFrameDelegate: Handle runtime error from iframe
   */
  onIFrameRuntimeError(message: string, stack: string): void {
    console.error("Remotion runtime error:", message, stack);
  }

  /**
   * IFrameDelegate: Handle player heights from iframe
   */
  onIFramePlayerStatus(heights: number[]): void {
    this.scrollManager?.handlePlayerHeights(heights);
  }

  /**
   * IFrameDelegate: Handle player scroll from iframe
   */
  onIFramePlayerScroll(scrollTop: number): void {
    this.scrollManager?.handlePlayerScroll(scrollTop);
  }

  onReflow(
    bandScrollHeight: number,
    bands: NullArray<Band>,
    playerScrollHeight: number,
    players: NullArray<Band>,
    interpolatorSpecs: InterpolatorSpec[],
  ): void {
    this.iframe?.reflow(
      bandScrollHeight,
      bands,
      playerScrollHeight,
      players,
      interpolatorSpecs,
    );
  }

  onScroll(editorScrollTop: number): void {
    this.iframe?.scroll(editorScrollTop);
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
    this.iframe?.reset();
  }

  public async updateBundleOutput(code: string): Promise<void> {
    if (!this.iframe) {
      console.warn("[Preview] Cannot update bundle output, iframe not ready");
      return;
    }

    // Shim window for vault file access (Obsidian concern)
    const iframeWindow = this.iframe.getContentWindow();
    if (iframeWindow) {
      shimWindow(
        iframeWindow as any,
        this.createStaticFileResolver(),
        this.app.vault.readBinary.bind(this.app.vault),
      );
    }

    // Send bundle to iframe (pure messaging)
    this.iframe.updateBundle(code);
  }

  public showErrorOverlay(message: string, stack?: string): void {
    this.iframe?.showError(message, stack);
  }

  public clearErrorOverlay(): void {
    this.iframe?.clearError();
  }
}
