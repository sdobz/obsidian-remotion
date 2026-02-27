/**
 * ResolutionContext: Centralized module resolution state
 *
 * Ensures consistent node_modules path resolution across bundling and language service.
 * Single source of truth for path calculations prevents resolution mismatches.
 */
import path from "path";
import { findNodeModulesPaths, getResolutionDirectory } from "remotion-md";

export class ResolutionContext {
  readonly vaultRoot: string;
  readonly nodeModulesPaths: string[];
  readonly resolutionDirectory: string;

  /**
   * Create a resolution context for a specific file location
   * @param vaultRoot Absolute path to vault root
   * @param sourceFilePath Absolute path to the source file being compiled
   */
  constructor(vaultRoot: string, sourceFilePath: string) {
    this.vaultRoot = vaultRoot;
    // Find all potential node_modules directories starting from source location
    this.nodeModulesPaths = findNodeModulesPaths(vaultRoot, path.dirname(sourceFilePath));
    // Determine resolution directory relative to source
    this.resolutionDirectory = getResolutionDirectory(
      this.nodeModulesPaths,
      path.dirname(sourceFilePath),
    );
  }

  /**
   * Create a context for vault root (e.g., for initial esbuild discovery)
   */
  static forVaultRoot(vaultRoot: string): ResolutionContext {
    return new ResolutionContext(vaultRoot, vaultRoot);
  }

  /**
   * Verify paths are valid (basic sanity check)
   */
  isValid(): boolean {
    return !!(
      this.vaultRoot &&
      this.nodeModulesPaths.length > 0 &&
      this.resolutionDirectory
    );
  }
}
