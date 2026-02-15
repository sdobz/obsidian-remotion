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
