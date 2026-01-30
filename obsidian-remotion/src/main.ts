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

export default class RemotionPlugin extends Plugin {
  public settings!: PluginSettings;
  private compilationManager!: CompilationManager;
  private viewManager!: ViewManager;
  private statusBarManager!: StatusBarManager;

  async onload() {
    console.log("Loading Remotion Plugin");
    await this.loadSettings();

    this.viewManager = new ViewManager(this.app);

    this.registerEditorExtension(editorDiagnosticsExtension);

    // Initialize managers
    const vaultRoot = getVaultRootPath(this.app);
    if (vaultRoot) {
      this.compilationManager = new CompilationManager(vaultRoot);
    }
    this.statusBarManager = new StatusBarManager(() => this.addStatusBarItem());

    // Set plugin directory for runtime
    setupPluginDirectory(this.app, this.manifest);

    // Register the Remotion preview view
    this.registerView(PREVIEW_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
      const view = new PreviewView(leaf, (typecheck, bundle) => {
        this.statusBarManager.updateTypecheck(typecheck);
        this.statusBarManager.updateBundle(bundle);
      });
      return view;
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

    // Open preview in right sidebar when workspace is ready
    this.app.workspace.onLayoutReady(() => {
      this.activateView();
    });

    // Initial check
    this.onActiveLeafChange();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private async onActiveLeafChange() {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

    if (activeView) {
      const previewView = this.viewManager.getPreviewView();
      if (previewView) {
        // Reset panel on note transition
        previewView.resetForNewFile();
      }
      this.schedulePreviewUpdate();
    }
  }

  private schedulePreviewUpdate(): void {
    if (!this.compilationManager) return;

    this.compilationManager.scheduleUpdate(async () => {
      await this.updatePreview();
    });
  }

  private async updatePreview(): Promise<void> {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const previewView = this.viewManager.getPreviewView();
    if (!activeView || !previewView) return;

    previewView.updateTypeCheckStatus("loading");
    previewView.updateBundleStatus("loading");

    const version = this.compilationManager.getCurrentVersion();
    const result = await this.compilationManager.compile(activeView, version);

    if (!result) {
      // Clear diagnostics on failure
      const cm = getEditorView(activeView);
      if (cm) clearEditorDiagnostics(cm);
      return;
    }

    // Update UI with compilation status
    previewView.updateTypeCheckStatus(
      result.typecheckStatus.status,
      result.typecheckStatus.errorCount,
    );
    previewView.updateBundleStatus(
      result.bundleStatus.status,
      result.bundleStatus.error,
    );

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
    previewView.updateBundleOutput(
      result.bundleCode,
      result.previewLocations,
      result.runtimeModules,
    );
  }

  async activateView() {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(PREVIEW_VIEW_TYPE);

    if (leaves.length > 0) {
      // A leaf with our view already exists, use that
      leaf = leaves[0];
    } else {
      // Create a new leaf in the right sidebar
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        leaf = rightLeaf;
        await leaf.setViewState({ type: PREVIEW_VIEW_TYPE, active: true });
      }
    }

    // Reveal the leaf so it becomes the active tab in the right sidebar
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async onunload() {
    console.log("Unloading Remotion Plugin");
    this.app.workspace.detachLeavesOfType(PREVIEW_VIEW_TYPE);
  }
}
