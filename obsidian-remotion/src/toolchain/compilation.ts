import { MarkdownView } from "obsidian";
import {
  extractCodeBlocks,
  classifyBlocks,
  synthesizeVirtualModule,
  mapDiagnosticsToMarkdown,
  parseBundleError,
  getRuntimeModules,
  type ClassifiedBlock,
  type MarkdownDiagnostic,
  type PreviewSpan,
  findNodeModulesPaths,
} from "remotion-md";
import path from "path";
import type esbuild from "esbuild";
import ts from "typescript";
import {
  createLanguageService,
  getPreviewCallLocations,
  mapPreviewLocationsToMarkdown,
  LanguageServiceQueries,
} from "./ts";
import {
  loadEsbuild,
  bundleTypeScriptSource,
  bundleDependenciesBundle,
} from "./bundler";

export interface CompilationResult {
  previewLocations: PreviewSpan[];
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
  private languageService: ts.LanguageService | null = null;
  private languageServiceHost: ts.LanguageServiceHost | null = null;
  private documentVersions = new Map<string, number>();
  private virtualFiles = new Map<string, string>();
  private lastVirtualFileName: string = "";
  private lastSynthesizedCode: string = "";
  private queries: LanguageServiceQueries | null = null;
  private lastNodeModulesPaths: string[] = [];

  // Dependency bundling cache
  private dependenciesCache: {
    moduleIds: string[];
    bundledCode: string;
  } | null = null;

  constructor(private vaultRoot: string) {
    this.esbuildInstance = loadEsbuild(this.vaultRoot);
  }

  scheduleUpdate(callback: () => Promise<void>, delay = 300): void {
    if (this.updateTimeoutId !== null)
      window.clearTimeout(this.updateTimeoutId);
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
    if (!activeView.file) return null;

    const startTime = performance.now();
    let classified: ClassifiedBlock[];
    const markdownText = activeView.editor.getValue();

    try {
      const blocks = extractCodeBlocks(markdownText);
      classified = classifyBlocks(blocks);
      if (classified.length > 0) this.lastExtractedBlocks = classified;
    } catch (err) {
      console.error("[remotion] Failed to extract code blocks:", err);
      classified = this.lastExtractedBlocks;
      if (classified.length === 0) return null;
    }

    const notePath = activeView.file.path;
    let synthesized: ReturnType<typeof synthesizeVirtualModule>;
    try {
      synthesized = synthesizeVirtualModule(notePath, classified);
    } catch (err) {
      console.error("[remotion] Failed to synthesize module:", err);
      return null;
    }

    const absoluteNotePath = path.join(this.vaultRoot, notePath);
    const virtualFileName = absoluteNotePath + ".tsx";
    const nodeModulesPaths = findNodeModulesPaths(
      this.vaultRoot,
      path.dirname(absoluteNotePath),
    );
    this.lastNodeModulesPaths = nodeModulesPaths;

    this.updateLanguageService(
      virtualFileName,
      synthesized.code,
      nodeModulesPaths,
      absoluteNotePath,
      markdownText,
    );

    const tsStart = performance.now();
    const [bundleResult] = await Promise.all([
      bundleTypeScriptSource(
        synthesized.code,
        virtualFileName,
        this.esbuildInstance,
        nodeModulesPaths,
        absoluteNotePath,
        markdownText,
      ),
    ]);
    const tsEnd = performance.now();

    if (version !== this.updateVersion) return null;

    // Get diagnostics directly from language service
    const syntacticDiagnostics =
      this.languageService?.getSyntacticDiagnostics(virtualFileName) || [];
    const semanticDiagnostics =
      this.languageService?.getSemanticDiagnostics(virtualFileName) || [];
    const diagnostics = [...syntacticDiagnostics, ...semanticDiagnostics];

    // Map diagnostics to markdown positions
    let markdownDiagnostics = mapDiagnosticsToMarkdown(
      diagnostics,
      synthesized.code,
      classified,
      synthesized.sceneExports,
    );

    const errorCount = markdownDiagnostics.filter(
      (d) => d.category === "error",
    ).length;

    // Handle bundle errors
    if (bundleResult.error) {
      const bundleError_mapped = parseBundleError(
        bundleResult.error,
        classified,
      );
      if (bundleError_mapped)
        markdownDiagnostics = [...markdownDiagnostics, bundleError_mapped];
    }

    // Get preview call locations from AST and map to markdown
    const previewLocationsRaw = getPreviewCallLocations(
      this.languageService,
      virtualFileName,
    );
    const previewLocations = mapPreviewLocationsToMarkdown(
      previewLocationsRaw,
      synthesized.code,
      activeView.editor.getValue(),
    );

    const endTime = performance.now();
    console.log(
      `[remotion] Parallel execution: ${(tsEnd - tsStart).toFixed(1)}ms | Total: ${(endTime - startTime).toFixed(1)}ms | Reload: ${(endTime - tsEnd).toFixed(1)}ms`,
    );

    const bundleError = bundleResult.error
      ? bundleResult.error instanceof Error
        ? bundleResult.error.message
        : String(bundleResult.error)
      : undefined;

    const bundleCode =
      bundleResult.code || "/* Bundle failed - see diagnostics */";

    // Extract runtime modules from synthesized code
    const runtimeModules = getRuntimeModules(synthesized.code);

    return {
      previewLocations,
      bundleCode,
      runtimeModules,
      typecheckStatus: { status: errorCount > 0 ? "error" : "ok", errorCount },
      bundleStatus: {
        status: bundleError ? "error" : "ok",
        error: bundleError,
      },
      diagnostics: markdownDiagnostics,
    };
  }

  private updateLanguageService(
    virtualFileName: string,
    sourceText: string,
    nodeModulesPaths: string[],
    activeMarkdownPath?: string,
    activeMarkdownText?: string,
  ): void {
    this.lastVirtualFileName = virtualFileName;
    this.lastSynthesizedCode = sourceText;
    this.virtualFiles.set(virtualFileName, sourceText);
    const currentVersion = this.documentVersions.get(virtualFileName) || 0;
    this.documentVersions.set(virtualFileName, currentVersion + 1);

    if (!this.languageService || !this.languageServiceHost) {
      const { languageService, languageServiceHost } = createLanguageService(
        virtualFileName,
        nodeModulesPaths,
        this.virtualFiles,
        this.documentVersions,
        activeMarkdownPath,
        activeMarkdownText,
      );
      this.languageService = languageService;
      this.languageServiceHost = languageServiceHost;
    }

    this.queries = new LanguageServiceQueries(
      this.languageService,
      this.lastVirtualFileName,
      this.lastSynthesizedCode,
    );
  }

  getLastExtractedBlocks(): ClassifiedBlock[] {
    return this.lastExtractedBlocks;
  }

  getCurrentVersion(): number {
    return this.updateVersion;
  }

  async getCompletionsAtPosition(
    view: MarkdownView,
    markdownPos: number,
    prefix?: string,
  ): Promise<ts.CompletionEntry[]> {
    if (!this.queries || !view) return [];
    return this.queries.getCompletions(
      view.editor.getValue(),
      markdownPos,
      prefix,
    );
  }

  async getQuickInfoAtPosition(
    view: MarkdownView,
    markdownPos: number,
  ): Promise<{
    displayParts: ts.SymbolDisplayPart[];
    documentation: ts.SymbolDisplayPart[];
  } | null> {
    if (!this.queries || !view) return null;
    return this.queries.getQuickInfo(view.editor.getValue(), markdownPos);
  }

  async getDefinitionAtPosition(
    view: MarkdownView,
    markdownPos: number,
  ): Promise<{ filePath: string; line: number; column: number } | null> {
    if (!this.queries || !view) return null;
    const result = await this.queries.getDefinition(
      view.editor.getValue(),
      markdownPos,
    );
    if (result && view.file) {
      result.filePath = view.file.path;
    }
    return result;
  }

  /**
   * Bundle all dependencies together in one bundle
   * Caches result and only rebundles when dependencies change
   */
  async bundleDependencies(moduleIds: string[]): Promise<string> {
    if (!this.esbuildInstance) {
      console.error("[remotion] esbuild instance not available");
      return "";
    }

    // Check if cache is valid
    const sortedIds = [...moduleIds].sort();
    const cacheValid =
      this.dependenciesCache &&
      this.dependenciesCache.moduleIds.length === sortedIds.length &&
      this.dependenciesCache.moduleIds.every(
        (id, idx) => id === sortedIds[idx],
      );

    if (cacheValid) {
      return this.dependenciesCache!.bundledCode;
    }

    // Cache miss - bundle all dependencies together
    const result = await bundleDependenciesBundle(
      moduleIds,
      this.esbuildInstance,
      this.lastNodeModulesPaths,
    );

    if (result.error) {
      console.error(
        "[remotion] Failed to bundle dependencies:",
        result.error.message,
      );
      return "";
    }

    // Update cache
    this.dependenciesCache = {
      moduleIds: sortedIds,
      bundledCode: result.code,
    };

    return result.code;
  }
}
