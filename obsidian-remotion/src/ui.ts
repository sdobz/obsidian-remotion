import { App, PluginSettingTab, Setting } from "obsidian";
import type { PreviewView } from "./preview";
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

export const PREVIEW_VIEW_TYPE = "remotion-preview-view";

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

  async toggle(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(PREVIEW_VIEW_TYPE)[0];

    if (existing) {
      this.app.workspace.detachLeavesOfType(PREVIEW_VIEW_TYPE);
    } else {
      await this.activate();
    }
  }

  async activate(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(PREVIEW_VIEW_TYPE)[0];

    if (existing) {
      this.app.workspace.revealLeaf(existing);
      return;
    }

    // Open in right sidebar
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;

    await leaf.setViewState({
      type: PREVIEW_VIEW_TYPE,
      active: false,
    });
    this.app.workspace.revealLeaf(leaf);
  }

  getPreviewView(): PreviewView | null {
    const leaf = this.app.workspace.getLeavesOfType(PREVIEW_VIEW_TYPE)[0];
    return leaf?.view instanceof Object ? (leaf.view as PreviewView) : null;
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
