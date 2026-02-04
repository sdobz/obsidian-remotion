import {
  Plugin,
  WorkspaceLeaf,
  MarkdownView,
  MarkdownRenderer,
} from "obsidian";
import { PreviewView, PREVIEW_VIEW_TYPE } from "./preview";
import {
  PluginSettings,
  DEFAULT_SETTINGS,
  getVaultRootPath,
  setupPluginDirectory,
} from "./config";
import { RemotionSettingTab, ViewManager, StatusBarManager } from "./ui";
import {
  editorDiagnosticsExtension,
  applyEditorDiagnostics,
  clearEditorDiagnostics,
  getEditorView,
  createAutocompleteExtension,
  createHoverExtension,
} from "./editor/index";
import { CompilationManager } from "./toolchain/compilation";
import { ScrollManager } from "./editor/scroll";

export default class RemotionPlugin extends Plugin {
  public settings!: PluginSettings;
  private compilationManager!: CompilationManager;
  private scrollManager: ScrollManager | null = null;
  private viewManager!: ViewManager;
  private statusBar!: StatusBarManager;

  async onload() {
    await this.loadSettings();

    this.viewManager = new ViewManager(this.app);
    this.statusBar = new StatusBarManager(this.addStatusBarItem.bind(this));

    this.registerEditorExtension(editorDiagnosticsExtension);

    // Initialize managers
    const vaultRoot = getVaultRootPath(this.app);
    if (vaultRoot) {
      this.compilationManager = new CompilationManager(vaultRoot);

      // Register Language Service extensions
      this.registerLanguageFeatures();
    }

    // Set plugin directory for runtime
    setupPluginDirectory(this.app, this.manifest);

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
      this.app.workspace.on("active-leaf-change", () =>
        this.onActiveLeafChange(),
      ),
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

      return await this.compilationManager.getCompletionsAtPosition(
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

        return await this.compilationManager.getQuickInfoAtPosition(
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

    this.updateScrollManager(activeView, previewView);

    if (activeView && previewView) {
      previewView.resetForNewFile();
      this.schedulePreviewUpdate();
    }
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
    if (!this.compilationManager || !this.viewManager.getVisiblePreviewView())
      return;

    this.compilationManager.scheduleUpdate(async () => {
      await this.updatePreview();
    });
  }

  private async updatePreview(): Promise<void> {
    const activeView = this.viewManager.getActiveMarkdownView();
    const previewView = this.viewManager.getVisiblePreviewView();
    if (!activeView || !previewView) return;

    this.statusBar.updateTypecheck({ status: "loading" });
    this.statusBar.updateBundle({ status: "loading" });

    const version = this.compilationManager.getCurrentVersion();
    const result = await this.compilationManager.compile(activeView, version);

    if (!result) {
      // Clear diagnostics and update status on failure
      const cm = getEditorView(activeView);
      if (cm) clearEditorDiagnostics(cm);
      this.statusBar.updateTypecheck({ status: "error" });
      this.statusBar.updateBundle({ status: "error" });
      return;
    }

    // Update UI with compilation status
    this.statusBar.updateTypecheck(result.typecheckStatus);
    this.statusBar.updateBundle(result.bundleStatus);

    // Apply diagnostics to editor (wiring layer responsibility)
    const cm = getEditorView(activeView);
    if (cm) {
      if (result.diagnostics.length > 0) {
        applyEditorDiagnostics(cm, result.diagnostics);
      } else {
        clearEditorDiagnostics(cm);
      }
    }

    // Send bundle output with semantic locations - previewView will handle pixel conversion
    previewView.updateBundleOutput(result.bundleCode);
    this.scrollManager?.handlePreviewSpans(result.previewLocations);

    if (result.bundleStatus.status === "error" && result.bundleStatus.error) {
      previewView.showErrorOverlay(result.bundleStatus.error);
    } else {
      previewView.clearErrorOverlay();
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
