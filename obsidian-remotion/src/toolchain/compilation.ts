import { MarkdownView } from "obsidian";
import {
  extractCodeBlocks,
  classifyBlocks,
  synthesizeVirtualModule,
  mapDiagnosticsToMarkdown,
  parseBundleError,
  type ClassifiedBlock,
  type MarkdownDiagnostic,
  type PreviewSpan,
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
import { ResolutionContext } from "./resolution-context";
import { BundleCache } from "./bundle-cache";

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
  private resolutionContext: ResolutionContext | null = null;
  private bundleCache = new BundleCache();

  constructor(private vaultRoot: string) {
    this.resolutionContext = ResolutionContext.forVaultRoot(vaultRoot);
    this.esbuildInstance = loadEsbuild(this.resolutionContext);
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

    // Create resolution context for this compilation
    this.resolutionContext = new ResolutionContext(
      this.vaultRoot,
      absoluteNotePath,
    );

    this.updateLanguageService(
      virtualFileName,
      synthesized.code,
      this.resolutionContext,
      absoluteNotePath,
      markdownText,
    );

    const tsStart = performance.now();
    const bundleResult = await bundleTypeScriptSource(
      synthesized.code,
      virtualFileName,
      this.esbuildInstance,
      this.resolutionContext,
      absoluteNotePath,
      markdownText,
    );
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

    const runtimeModules = bundleResult.bundledModules || new Set<string>();

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
    context: ResolutionContext,
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
        context.nodeModulesPaths,
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
   * Bundle dependencies with content-hash caching
   * Only rebundles when module list changes (content hash based)
   */
  async bundleDependencies(moduleIds: string[]): Promise<string> {
    if (!this.esbuildInstance || !this.resolutionContext) {
      console.error("[remotion] esbuild or resolution context not available");
      return "";
    }

    // Use content-hash cache to avoid rebundling identical module sets
    return await this.bundleCache.getDepsBundle(moduleIds, async () => {
      const result = await bundleDependenciesBundle(
        moduleIds,
        this.esbuildInstance!,
        this.resolutionContext!,
      );

      if (result.error) {
        console.error(
          "[remotion] Failed to bundle dependencies:",
          result.error.message,
        );
        return "";
      }

      return result.code;
    });
  }
}
