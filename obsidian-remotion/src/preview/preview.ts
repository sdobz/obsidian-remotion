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
import {
  Runtime,
  type RuntimeDelegate,
} from "./runtime";

export const PREVIEW_VIEW_TYPE = "remotion-preview-view";

export class PreviewView extends ItemView implements ScrollDelegate, RuntimeDelegate {
  private runtime: Runtime | null = null;
  private scrollManager: ScrollManager | null = null;

  getHostWindow(): Window {
    return window;
  }

  prepareContainer(container: HTMLElement): void {
    container.innerHTML = "";
    container.classList.add("remotion-preview-container");
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

    this.runtime = new Runtime(this);
    this.runtime.setHandlers({
      onRuntimeError: (message: string, stack: string) => {
        console.error("Remotion runtime error:", message, stack);
      },
      onPlayerStatus: (heights: number[]) => {
        this.scrollManager?.handlePlayerHeights(heights);
      },
      onPlayerScroll: (scrollTop: number) => {
        this.scrollManager?.handlePlayerScroll(scrollTop);
      },
    });
    await this.runtime.mount(container);
  }

  async onClose() {
    if (this.runtime) {
      await this.runtime.unmount();
      this.runtime = null;
    }
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
    this.runtime?.reflow(
      bandScrollHeight,
      bands,
      playerScrollHeight,
      players,
      interpolatorSpecs,
    );
  }

  onScroll(editorScrollTop: number): void {
    this.runtime?.scroll(editorScrollTop);
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
    this.runtime?.reset();
  }

  public async updateBundleOutput(code: string): Promise<void> {
    if (!this.runtime) {
      console.warn("[Preview] Cannot update bundle output, runtime not ready");
      return;
    }

    // Shim window for vault file access (Obsidian concern)
    const runtimeWindow = this.runtime.getContentWindow();
    if (runtimeWindow) {
      shimWindow(
        runtimeWindow as any,
        this.createStaticFileResolver(),
        this.app.vault.readBinary.bind(this.app.vault),
      );
    }

    this.runtime.updateBundle(code);
  }

  public showErrorOverlay(message: string, stack?: string): void {
    this.runtime?.showError(message, stack);
  }

  public clearErrorOverlay(): void {
    this.runtime?.clearError();
  }
}
