import { App, FileSystemAdapter, PluginManifest } from "obsidian";
import path from "path";

/**
 * Configuration Module
 *
 * Centralizes all configuration and utility logic including:
 * - Plugin settings data structures
 * - Default values
 * - Vault path resolution
 * - Plugin directory setup
 */

// ============================================================================
// Settings Data
// ============================================================================

export interface PluginSettings {
  defaultFps: number;
  defaultWidth: number;
  defaultHeight: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  defaultFps: 30,
  defaultWidth: 1920,
  defaultHeight: 1080,
};

// ============================================================================
// Path Utilities
// ============================================================================

/**
 * Get the vault root path from the Obsidian app
 */
export function getVaultRootPath(app: App): string | null {
  const adapter = app.vault.adapter;
  if (adapter instanceof FileSystemAdapter) {
    const basePath = adapter.getBasePath();
    if (basePath && basePath.startsWith("app://")) {
      return basePath.replace(/^app:\/\/[^\/]+/, "");
    }
    return basePath;
  }
  return null;
}

/**
 * Setup the plugin directory path for runtime access
 */
export function setupPluginDirectory(
  app: App,
  manifest?: PluginManifest,
): void {
  try {
    const vaultRoot = getVaultRootPath(app);
    const configDir = (app.vault as any).configDir || ".obsidian";
    if (vaultRoot && manifest?.id) {
      const pluginDir = path.join(vaultRoot, configDir, "plugins", manifest.id);
      (globalThis as any).__REMOTION_PLUGIN_DIR = pluginDir;
    }
  } catch (err) {
    // Silently fail if plugin dir cannot be set
  }
}
