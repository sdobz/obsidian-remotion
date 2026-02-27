/**
 * Bundler module - delegates to remotion-md
 *
 * This module now re-exports bundling functionality from remotion-md.
 * All bundling logic has been moved to remotion-md to make it pure and testable.
 */

import type esbuild from "esbuild";
import * as RemotionMd from "remotion-md";

// Re-export types and namespaces
export type BundleResult = RemotionMd.BundleResult;
export type BundleContext = RemotionMd.BundleContext;
export const PluginFactories = RemotionMd.PluginFactories;

// Re-export functions
export const loadEsbuild = RemotionMd.loadEsbuild;
export const bundleTypeScriptSource = RemotionMd.bundleTypeScriptSource;
export const bundleDependenciesBundle = RemotionMd.bundleDependenciesBundle;
