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
  type RuntimeCommand,
  type RuntimeDelegate,
  type RuntimeMessage,
  type MountedRuntime,
} from "./runtime";

export const PREVIEW_VIEW_TYPE = "remotion-preview-view";

export class PreviewView extends ItemView implements ScrollDelegate, RuntimeDelegate {
  private runtime: Runtime | null = null;
  private scrollManager: ScrollManager | null = null;

  private createRuntimeIFrame(container: HTMLElement): HTMLIFrameElement {
    const iframe = document.createElement("iframe");
    iframe.classList.add("remotion-runtime-iframe");
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "0";
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
    iframe.srcdoc = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; width: 100%; height: 100%; background: #000; overflow: hidden; }
      #bands-scroller { position: absolute; top: 0; left: 0; right: 0; bottom: 0; }
      #players-scroller { position: absolute; top: 0; left: 0; right: 0; bottom: 0; }
      #link-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
    </style>
  </head>
  <body>
    <div id="bands-scroller"><div id="bands-container"></div></div>
    <svg id="link-overlay"></svg>
    <div id="players-scroller"><div id="players-container"></div></div>
    <script>
      (() => {
        const emit = (message) => window.parent.postMessage(message, "*");
        const executeBundle = (payload) => {
          try {
            const fn = new Function("window", payload);
            fn(window);
            if (window.RemotionBundle) {
              emit({ type: "player-status", players: [] });
            }
          } catch (error) {
            emit({
              type: "runtime-error",
              error: {
                message: error?.message ?? "Unknown runtime error",
                stack: error?.stack ?? "",
              },
            });
          }
        };

        window.addEventListener("message", (event) => {
          const command = event.data;
          if (!command || typeof command !== "object") return;

          if (command.type === "bundle") {
            executeBundle(command.payload);
            return;
          }

          if (command.type === "scroll") {
            emit({ type: "player-scroll", playerScrollTop: command.editorScrollTop });
          }
        });

        emit({ type: "runtime-ready" });
      })();
    </script>
  </body>
</html>`;

    container.appendChild(iframe);
    return iframe;
  }

  prepareContainer(container: HTMLElement): void {
    container.innerHTML = "";
    container.classList.add("remotion-preview-container");
  }

  async mountRuntime(
    container: HTMLElement,
    onMessage: (message: RuntimeMessage) => void,
  ): Promise<MountedRuntime> {
    const iframe = this.createRuntimeIFrame(container);

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data as RuntimeMessage;
      if (!data || typeof data !== "object" || !("type" in data)) return;
      onMessage(data);
    };

    window.addEventListener("message", handleMessage);

    return {
      postCommand: (command: RuntimeCommand) => {
        iframe.contentWindow?.postMessage(command, "*");
      },
      getContentWindow: () => iframe.contentWindow,
      unmount: async () => {
        window.removeEventListener("message", handleMessage);
        iframe.remove();
        container.innerHTML = "";
      },
    };
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
