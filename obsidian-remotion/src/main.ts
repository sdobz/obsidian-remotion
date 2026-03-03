import {
  Plugin,
  WorkspaceLeaf,
  MarkdownView,
  MarkdownRenderer,
} from "obsidian";
import { PreviewView, PREVIEW_VIEW_TYPE } from "./preview/preview";
import { PluginSettings, DEFAULT_SETTINGS, getVaultRootPath } from "./config";
import { RemotionSettingTab, ViewManager, StatusBarManager } from "./ui";
import {
  editorDiagnosticsExtension,
  applyEditorDiagnostics,
  clearEditorDiagnostics,
  getEditorView,
  createAutocompleteExtension,
  createHoverExtension,
} from "./editor/index";
import { TypecheckManager } from "./toolchain/compilation";
import { ScrollManager } from "./editor/scroll";
import { BundlePipeline, loadEsbuild, ResolutionContext } from "remotion-md";
import path from "path";

export default class RemotionPlugin extends Plugin {
  public settings!: PluginSettings;
  private typecheckManager!: TypecheckManager;
  private bundlePipeline!: BundlePipeline;
  private esbuildInstance: any = null;
  private scrollManager: ScrollManager | null = null;
  private viewManager!: ViewManager;
  private statusBar!: StatusBarManager;
  private lastActiveMarkdownView: MarkdownView | null = null;
  private lastActiveFilePath: string | null = null;
  private lastPreviewView: PreviewView | null = null;
  private vaultRoot: string = "";

  async onload() {
    await this.loadSettings();

    this.viewManager = new ViewManager(this.app);
    this.statusBar = new StatusBarManager(this.addStatusBarItem.bind(this));

    this.registerEditorExtension(editorDiagnosticsExtension);

    // Initialize managers
    const vaultRoot = getVaultRootPath(this.app);
    this.vaultRoot = vaultRoot ?? "";
    if (vaultRoot) {
      this.typecheckManager = new TypecheckManager(vaultRoot);
      this.bundlePipeline = new BundlePipeline();
      const resolutionContext = ResolutionContext.forVaultRoot(vaultRoot);
      this.esbuildInstance = loadEsbuild(resolutionContext.nodeModulesPaths);

      // Register Language Service extensions
      this.registerLanguageFeatures();
    }

    // Register the Remotion preview view
    this.registerView(
      PREVIEW_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new PreviewView(leaf),
    );

    this.addRibbonIcon("camera", "Open Remotion preview", async () => {
      await this.viewManager.openPreviewPane();
      this.onActiveLeafChange();
    });

    // Add settings tab
    this.addSettingTab(new RemotionSettingTab(this.app, this));

    // Register event handlers
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.onActiveLeafChange();
      }),
    );

    this.registerEvent(
      this.app.workspace.on("editor-change", () =>
        this.schedulePreviewUpdate(),
      ),
    );

    // Update state when workspace is ready
    this.app.workspace.onLayoutReady(() => {
      this.onActiveLeafChange();
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private registerLanguageFeatures(): void {
    // Create autocomplete extension
    const autocompleteExt = createAutocompleteExtension(async (pos, prefix) => {
      const activeView = this.viewManager.getActiveMarkdownView();
      if (!activeView) return [];

      return await this.typecheckManager.getCompletionsAtPosition(
        activeView,
        pos,
        prefix,
      );
    });

    // Create hover extension
    const hoverExt = createHoverExtension(
      async (pos) => {
        const activeView = this.viewManager.getActiveMarkdownView();
        if (!activeView) return null;

        return await this.typecheckManager.getQuickInfoAtPosition(
          activeView,
          pos,
        );
      },
      (markdown, container) => {
        const activeView = this.viewManager.getActiveMarkdownView();
        const sourcePath = activeView?.file?.path ?? "";
        container.innerHTML = "";
        MarkdownRenderer.renderMarkdown(markdown, container, sourcePath, this);
      },
    );

    this.registerEditorExtension([autocompleteExt, hoverExt]);
  }

  private async onActiveLeafChange() {
    const activeView = this.viewManager.getActiveMarkdownView();
    const previewView = this.viewManager.getVisiblePreviewView();
    const activePath = activeView?.file?.path ?? null;

    const activeViewChanged = activeView !== this.lastActiveMarkdownView;
    const previewViewChanged = previewView !== this.lastPreviewView;
    const activePathChanged = activePath !== this.lastActiveFilePath;
    const previewBecameVisible = !this.lastPreviewView && !!previewView;

    if (activeViewChanged || previewViewChanged) {
      this.updateScrollManager(activeView, previewView);
    }

    if (
      activeView &&
      previewView &&
      (activePathChanged || previewBecameVisible)
    ) {
      previewView.resetForNewFile();
      this.schedulePreviewUpdate();
    }

    this.lastActiveMarkdownView = activeView;
    this.lastActiveFilePath = activePath;
    this.lastPreviewView = previewView;
  }

  private updateScrollManager(
    activeView: MarkdownView | null,
    previewView: PreviewView | null,
  ): void {
    // Destroy old scroll manager if active view changed
    if (this.scrollManager) {
      this.scrollManager.destroy();
      this.scrollManager = null;
    }

    if (!previewView || !activeView) return;

    const editorView = getEditorView(activeView);

    if (editorView) {
      this.scrollManager = new ScrollManager(editorView, previewView);
      previewView.setScrollManager(this.scrollManager);
    }
  }

  private schedulePreviewUpdate(): void {
    if (!this.typecheckManager || !this.viewManager.getVisiblePreviewView())
      return;

    this.typecheckManager.scheduleUpdate(async () => {
      await this.updatePreview();
    });
  }

  private async updatePreview(): Promise<void> {
    const activeView = this.viewManager.getActiveMarkdownView();
    const previewView = this.viewManager.getVisiblePreviewView();
    if (!activeView || !previewView) return;

    this.statusBar.updateTypecheck({ status: "loading" });
    this.statusBar.updateBundle({ status: "loading" });

    const version = this.typecheckManager.getCurrentVersion();
    const markdown = activeView.editor.getValue();
    const notePath = activeView.file?.path;

    if (!notePath) return;

    // Run typecheck and bundling in parallel
    const [typecheckResult, bundleResult] = await Promise.all([
      this.typecheckManager.typecheck(markdown, notePath, version),
      this.bundle(markdown, notePath),
    ]);

    if (!typecheckResult) {
      // Clear diagnostics and update status on failure
      const cm = getEditorView(activeView);
      if (cm) clearEditorDiagnostics(cm);
      this.statusBar.updateTypecheck({ status: "error" });
      this.statusBar.updateBundle({ status: "error" });
      return;
    }

    // Update UI with typecheck status
    this.statusBar.updateTypecheck(typecheckResult.typecheckStatus);
    this.statusBar.updateBundle(bundleResult?.bundleStatus ?? { status: "error" });

    // Apply diagnostics to editor (wiring layer responsibility)
    const cm = getEditorView(activeView);
    if (cm) {
      if (typecheckResult.diagnostics.length > 0) {
        applyEditorDiagnostics(cm, typecheckResult.diagnostics);
      } else {
        clearEditorDiagnostics(cm);
      }
    }

    // Update preview with bundle code
    if (bundleResult) {
      await previewView.updateBundleOutput(bundleResult.bundleCode);
      this.scrollManager?.handlePreviewSpans(typecheckResult.previewLocations);

      if (bundleResult.bundleStatus.status === "error" && bundleResult.bundleStatus.error) {
        previewView.showErrorOverlay(bundleResult.bundleStatus.error);
      } else {
        previewView.clearErrorOverlay();
      }
    }
  }

  /**
   * Bundle markdown code.
   * Orchestrates the bundling pipeline (now independent of typecheck).
   */
  private async bundle(
    markdown: string,
    notePath: string,
  ): Promise<{
    bundleCode: string;
    bundleStatus: { status: "ok" | "error"; error?: string };
  } | null> {
    try {
      const absoluteNotePath = path.join(this.vaultRoot, notePath);
      const resolutionContext = new ResolutionContext(
        this.vaultRoot,
        absoluteNotePath,
      );

      const result = await this.bundlePipeline.process({
        markdown,
        notePath,
        absoluteNotePath,
        context: resolutionContext,
        esbuildInstance: this.esbuildInstance,
      });

      return {
        bundleCode: result.bundleCode,
        bundleStatus: result.bundleStatus,
      };
    } catch (err) {
      console.error("[remotion] Bundling failed:", err);
      return {
        bundleCode: "/* Bundling error */",
        bundleStatus: {
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  async onunload() {
    if (this.scrollManager) {
      this.scrollManager.destroy();
      this.scrollManager = null;
    }
    this.viewManager.detach();
  }
}
