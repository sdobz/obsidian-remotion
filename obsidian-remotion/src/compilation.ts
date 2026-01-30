import { MarkdownView } from "obsidian";
import {
  extractCodeBlocks,
  classifyBlocks,
  synthesizeVirtualModule,
  compileVirtualModule,
  mapDiagnosticsToMarkdown,
  parseBundleError,
  type ClassifiedBlock,
  type MarkdownDiagnostic,
} from "remotion-md";
import { bundleVirtualModule } from "./bundler";
import path from "path";
import fs from "fs";
import type esbuild from "esbuild";

export interface CompilationResult {
  blocks: ClassifiedBlock[];
  previewLocations: Array<{
    line: number;
    column: number;
    text: string;
    options?: Record<string, any>;
    pos?: number;
    length?: number;
  }>;
  bundleCode: string;
  runtimeModules: Set<string>;
  typecheckStatus: { status: "ok" | "error"; errorCount: number };
  bundleStatus: { status: "ok" | "error"; error?: string };
  diagnostics: MarkdownDiagnostic[];
}

export class CompilationManager {
  private updateTimeoutId: number | null = null;
  private updateVersion = 0;
  private lastExtractedBlocks: ClassifiedBlock[] = [];
  private esbuildInstance: typeof esbuild | null = null;

  constructor(private vaultRoot: string) {
    this.esbuildInstance = this.loadEsbuild();
  }

  scheduleUpdate(callback: () => Promise<void>, delay = 300): void {
    if (this.updateTimeoutId !== null) {
      window.clearTimeout(this.updateTimeoutId);
    }

    this.updateTimeoutId = window.setTimeout(() => {
      this.updateTimeoutId = null;
      this.updateVersion += 1;
      void callback();
    }, delay);
  }

  async compile(
    activeView: MarkdownView,
    version: number,
  ): Promise<CompilationResult | null> {
    if (!activeView.file) {
      return null;
    }

    const startTime = performance.now();

    let blocks: ReturnType<typeof extractCodeBlocks>;
    let classified: ClassifiedBlock[];

    try {
      // Extract and classify code blocks - should be resilient to partial input
      blocks = extractCodeBlocks(activeView.editor.getValue());
      classified = classifyBlocks(blocks);

      // Only update cached blocks if we have valid content
      if (classified.length > 0) {
        this.lastExtractedBlocks = classified;
      }
    } catch (err) {
      console.error("[remotion] Failed to extract code blocks:", err);
      // Keep last known good state to avoid disrupting preview
      classified = this.lastExtractedBlocks;
      if (classified.length === 0) return null;
    }

    const notePath = activeView.file.path;
    let synthesized: ReturnType<typeof synthesizeVirtualModule>;

    try {
      synthesized = synthesizeVirtualModule(notePath, classified);
    } catch (err) {
      console.error("[remotion] Failed to synthesize module:", err);
      // Continue with empty synthesis to prevent breaking the preview
      return null;
    }

    const absoluteNotePath = path.join(this.vaultRoot, notePath);
    const virtualFileName = absoluteNotePath.replace(/\.md$/, ".tsx");
    const nodeModulesPaths = this.findNodeModulesPaths(
      path.dirname(absoluteNotePath),
    );

    // TypeScript compilation - wrapped in try-catch for resilience
    const tsStart = performance.now();
    let compiled: ReturnType<typeof compileVirtualModule>;
    try {
      compiled = compileVirtualModule(
        virtualFileName,
        synthesized.code,
        nodeModulesPaths,
      );
    } catch (err) {
      console.error("[remotion] TypeScript compilation failed:", err);
      return null;
    }
    const tsEnd = performance.now();

    let markdownDiagnostics = mapDiagnosticsToMarkdown(
      compiled.diagnostics,
      synthesized.code,
      classified,
      synthesized.sceneExports,
    );

    const errorCount = markdownDiagnostics.filter(
      (d) => d.category === "error",
    ).length;

    if (version !== this.updateVersion) return null;

    // Bundling - wrapped in try-catch for resilience
    const bundleStart = performance.now();
    let bundled: Awaited<ReturnType<typeof bundleVirtualModule>>;
    let bundleError: string | undefined;

    if (!this.esbuildInstance) {
      bundleError = "esbuild not available";
      bundled = {
        code: "/* esbuild not found - install esbuild in your vault */",
        error: new Error(bundleError),
      };
    } else {
      try {
        bundled = await bundleVirtualModule(
          compiled.code,
          virtualFileName,
          this.esbuildInstance,
          compiled.runtimeModules,
        );
      } catch (err) {
        console.error("[remotion] Bundle failed:", err);
        bundleError = err instanceof Error ? err.message : String(err);
        // Return fallback result with error message
        bundled = {
          code: "/* Bundle failed - see console */",
          error: err as Error,
        };
      }
    }
    const bundleEnd = performance.now();

    if (version !== this.updateVersion) return null;

    // Add bundle errors to diagnostics, but don't prevent rendering
    if (bundled.error) {
      const bundleError_mapped = parseBundleError(bundled.error, classified);
      if (bundleError_mapped) {
        markdownDiagnostics = [...markdownDiagnostics, bundleError_mapped];
      }
    }

    // Return diagnostics as data - let caller apply to editor
    const previewLocations = this.mapPreviewLocationsToMarkdown(
      compiled.previewLocations,
      synthesized.code,
      classified,
    );

    // Log performance metrics
    const endTime = performance.now();
    const totalTime = endTime - startTime;
    const tsTime = tsEnd - tsStart;
    const bundleTime = bundleEnd - bundleStart;
    const reloadTime = endTime - bundleEnd;

    console.log(
      `[remotion] TypeScript: ${tsTime.toFixed(1)}ms | Bundle: ${bundleTime.toFixed(1)}ms | Reload: ${reloadTime.toFixed(1)}ms | Total: ${totalTime.toFixed(1)}ms`,
    );

    return {
      blocks: classified,
      previewLocations,
      bundleCode: bundled.code || "/* Bundle failed - see diagnostics */",
      runtimeModules: compiled.runtimeModules,
      typecheckStatus: { status: errorCount > 0 ? "error" : "ok", errorCount },
      bundleStatus: {
        status: bundleError ? "error" : "ok",
        error: bundleError,
      },
      diagnostics: markdownDiagnostics,
    };
  }

  private mapPreviewLocationsToMarkdown(
    locations: Array<{
      line: number;
      column: number;
      text: string;
      options?: Record<string, any>;
      pos?: number;
      length?: number;
    }>,
    synthCode: string,
    blocks: ClassifiedBlock[],
  ): CompilationResult["previewLocations"] {
    const synthLines = synthCode.split("\n");
    const blockLineMap: Array<{
      synthStartLine: number;
      markdownStartLine: number;
    }> = [];
    const sentinelRegex = /^\/\/ --- block \d+ @ .*:(\d+) ---$/;

    for (let i = 0; i < synthLines.length; i++) {
      const match = synthLines[i].match(sentinelRegex);
      if (match) {
        const markdownStartLine = Number(match[1]);
        const synthStartLine = i + 1 + 2; // sentinel line + blank line
        blockLineMap.push({ synthStartLine, markdownStartLine });
      }
    }

    const mapSynthLineToMarkdownLine = (synthLine: number) => {
      let current = blockLineMap[0];
      for (const entry of blockLineMap) {
        if (entry.synthStartLine <= synthLine) {
          current = entry;
        } else {
          break;
        }
      }
      if (!current) return synthLine;
      return current.markdownStartLine + (synthLine - current.synthStartLine);
    };

    return locations.map((loc) => ({
      line: mapSynthLineToMarkdownLine(loc.line),
      column: loc.column,
      text: loc.text,
      options: loc.options,
      pos: loc.pos,
      length: loc.length,
    }));
  }

  getLastExtractedBlocks(): ClassifiedBlock[] {
    return this.lastExtractedBlocks;
  }

  getCurrentVersion(): number {
    return this.updateVersion;
  }

  private loadEsbuild(): typeof esbuild | null {
    const nodeModulesPaths = this.findNodeModulesPaths(this.vaultRoot);

    // Prefer vault-local esbuild if present
    for (const modulesPath of nodeModulesPaths) {
      const candidate = path.join(modulesPath, "esbuild");
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require(candidate);
      } catch {
        // continue
      }
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require("esbuild");
    } catch (err) {
      console.error(
        "[remotion] esbuild not found. Install esbuild in your vault (npm i esbuild).",
      );
      return null;
    }
  }

  private findNodeModulesPaths(startDir: string): string[] {
    const paths: string[] = [];
    let current = startDir;

    // Search upward from startDir to vaultRoot
    while (current.startsWith(this.vaultRoot)) {
      const candidate = path.join(current, "node_modules");
      if (fs.existsSync(candidate)) {
        paths.push(candidate);
        break;
      }

      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }

    // Add vault root node_modules if not already added
    const rootNodeModules = path.join(this.vaultRoot, "node_modules");
    if (fs.existsSync(rootNodeModules) && !paths.includes(rootNodeModules)) {
      paths.push(rootNodeModules);
    }

    // Search upward from vault root (for monorepo scenarios)
    current = this.vaultRoot;
    while (true) {
      const parent = path.dirname(current);
      if (parent === current) break;

      const candidate = path.join(parent, "node_modules");
      if (fs.existsSync(candidate) && !paths.includes(candidate)) {
        paths.push(candidate);
        break;
      }

      current = parent;
    }

    return paths;
  }
}
