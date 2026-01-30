import { App, PluginSettingTab, Setting, MarkdownView } from "obsidian";
import { PREVIEW_VIEW_TYPE, PreviewView } from "./preview";
import type RemotionPlugin from "./main";

/**
 * UI Management Module
 *
 * Centralizes all UI-related concerns including:
 * - View lifecycle management (PreviewView creation/destruction)
 * - Status bar updates and indicators
 * - Scroll synchronization between editor and preview
 * - Settings UI panel
 */

// ============================================================================
// Type Definitions
// ============================================================================

export interface StatusInfo {
  status: string;
  errorCount?: number;
  error?: string | null;
}

// ============================================================================
// View Management
// ============================================================================

export class ViewManager {
  constructor(private app: App) {}

  private isLeafVisible(
    leaf: { view?: { containerEl?: HTMLElement } } | null,
  ): boolean {
    const el = leaf?.view?.containerEl;
    if (!el) return false;
    const anyEl = el as unknown as { isShown?: () => boolean };
    if (typeof anyEl.isShown === "function") return anyEl.isShown();
    return (
      el.offsetParent !== null && el.clientHeight > 0 && el.clientWidth > 0
    );
  }

  async ensureSidebarTab(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(PREVIEW_VIEW_TYPE);

    if (leaves.length > 0) {
      // Tab already exists, do not reveal or activate it
      return;
    }

    // Create a new leaf in the right sidebar without activating it
    const rightLeaf = this.app.workspace.getRightLeaf(false);
    if (!rightLeaf) return;

    await rightLeaf.setViewState({ type: PREVIEW_VIEW_TYPE, active: false });
  }

  getVisiblePreviewView(): PreviewView | null {
    const leaf = this.app.workspace.getLeavesOfType(PREVIEW_VIEW_TYPE)[0];
    const view = leaf?.view;
    if (!(view instanceof PreviewView)) return null;
    return this.isLeafVisible(leaf) ? view : null;
  }

  getActiveMarkdownView(): MarkdownView | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) return active;

    const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of markdownLeaves) {
      const view = leaf.view;
      if (view instanceof MarkdownView) return view;
    }

    return null;
  }

  detach(): void {
    this.app.workspace.detachLeavesOfType(PREVIEW_VIEW_TYPE);
  }
}

// ============================================================================
// Status Bar Management
// ============================================================================

export class StatusBarManager {
  private typecheckItem: HTMLElement | null = null;
  private bundleItem: HTMLElement | null = null;

  constructor(private addStatusBarItem: () => HTMLElement) {
    this.typecheckItem = this.addStatusBarItem();
    this.typecheckItem.setText("📝 Types");

    this.bundleItem = this.addStatusBarItem();
    this.bundleItem.setText("📦 Bundle");
  }

  updateTypecheck(status?: StatusInfo) {
    if (!status || !this.typecheckItem) return;

    let icon = "📝";
    let text = "Types";
    let color = "";

    if (status.status === "loading") {
      icon = "⏳";
      text = "Types...";
    } else if (status.status === "ok") {
      icon = "✓";
      color = "color: var(--text-success);";
    } else {
      icon = "✗";
      color = "color: var(--text-error);";
      if (status.errorCount && status.errorCount > 0) {
        text = `Types (${status.errorCount})`;
      }
    }

    this.typecheckItem.setText(`${icon} ${text}`);
    this.typecheckItem.style.cssText = color;
  }

  updateBundle(status?: StatusInfo) {
    if (!status || !this.bundleItem) return;

    let icon = "📦";
    let text = "Bundle";
    let color = "";

    if (status.status === "loading") {
      icon = "⏳";
      text = "Bundle...";
    } else if (status.status === "ok") {
      icon = "✓";
      color = "color: var(--text-success);";
    } else {
      icon = "✗";
      color = "color: var(--text-error);";
    }

    this.bundleItem.setText(`${icon} ${text}`);
    this.bundleItem.style.cssText = color;
  }

  cleanup() {
    this.typecheckItem = null;
    this.bundleItem = null;
  }
}

// ============================================================================
// Settings Tab
// ============================================================================

export class RemotionSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: RemotionPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();
    containerEl.createEl("h2", { text: "Remotion Preview Settings" });

    new Setting(containerEl)
      .setName("Default FPS")
      .setDesc("Default frames per second for Remotion compositions.")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.defaultFps))
          .onChange(async (value) => {
            const fps = parseInt(value);
            if (!isNaN(fps) && fps > 0) {
              this.plugin.settings.defaultFps = fps;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName("Default Width")
      .setDesc("Default composition width in pixels.")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.defaultWidth))
          .onChange(async (value) => {
            const width = parseInt(value);
            if (!isNaN(width) && width > 0) {
              this.plugin.settings.defaultWidth = width;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName("Default Height")
      .setDesc("Default composition height in pixels.")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.defaultHeight))
          .onChange(async (value) => {
            const height = parseInt(value);
            if (!isNaN(height) && height > 0) {
              this.plugin.settings.defaultHeight = height;
              await this.plugin.saveSettings();
            }
          }),
      );
  }
}
