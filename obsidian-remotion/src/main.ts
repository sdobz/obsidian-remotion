import { Plugin, WorkspaceLeaf, MarkdownView } from "obsidian";
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
} from "./editor";
import { CompilationManager } from "./compilation";
import { ScrollManager } from "./scroll";

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
    }

    // Set plugin directory for runtime
    setupPluginDirectory(this.app, this.manifest);

    // Register the Remotion preview view
    this.registerView(
      PREVIEW_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new PreviewView(leaf),
    );

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

    // Open preview in right sidebar when workspace is ready
    this.app.workspace.onLayoutReady(() => {
      void this.viewManager.ensureSidebarTab();
      this.onActiveLeafChange();
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
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
    const scrollDOM = editorView?.scrollDOM;
    const container = activeView.leaf.view.containerEl;

    if (scrollDOM && editorView) {
      this.scrollManager = new ScrollManager(
        scrollDOM,
        container,
        editorView,
        previewView,
      );
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
    previewView.updateBundleOutput(result.bundleCode, result.runtimeModules);
    this.scrollManager?.handlePreviewSpans(result.previewLocations);
  }

  async onunload() {
    if (this.scrollManager) {
      this.scrollManager.destroy();
      this.scrollManager = null;
    }
    this.viewManager.detach();
  }
}
