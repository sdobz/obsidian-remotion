import {
  extractCodeBlocks,
  classifyBlocks,
  synthesizeVirtualModule,
  mapDiagnosticsToMarkdown,
  ResolutionContext,
  type ClassifiedBlock,
  type MarkdownDiagnostic,
  type PreviewSpan,
} from "remotion-md";
import path from "path";
import ts from "typescript";
import { MarkdownView } from "obsidian";
import {
  createLanguageService,
  getPreviewCallLocations,
  mapPreviewLocationsToMarkdown,
  LanguageServiceQueries,
} from "./ts";

/**
 * TypecheckResult - output of type checking only.
 * Bundling is no longer a responsibility of this manager.
 */
export interface TypecheckResult {
  previewLocations: PreviewSpan[];
  typecheckStatus: { status: "ok" | "error"; errorCount: number };
  diagnostics: MarkdownDiagnostic[];
  synthesizedCode: string;
  classified: ClassifiedBlock[];
}

/**
 * TypecheckManager - handles TypeScript diagnostics only.
 * Bundling is delegated to a separate BundlePipeline (in main.ts wiring layer).
 */
export class TypecheckManager {
  private updateTimeoutId: number | null = null;
  private updateVersion = 0;
  private lastExtractedBlocks: ClassifiedBlock[] = [];
  private languageService: ts.LanguageService | null = null;
  private languageServiceHost: ts.LanguageServiceHost | null = null;
  private documentVersions = new Map<string, number>();
  private virtualFiles = new Map<string, string>();
  private lastVirtualFileName: string = "";
  private lastSynthesizedCode: string = "";
  private queries: LanguageServiceQueries | null = null;
  private resolutionContext: ResolutionContext | null = null;

  constructor(private vaultRoot: string) {
    this.resolutionContext = ResolutionContext.forVaultRoot(vaultRoot);
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

  /**
   * Typecheck markdown code.
   * Generic method: accepts markdown text and path directly (not Obsidian-specific).
   * Bundling is handled separately by BundlePipeline in main.ts.
   */
  async typecheck(
    markdown: string,
    notePath: string,
    version: number,
  ): Promise<TypecheckResult | null> {
    const startTime = performance.now();
    let classified: ClassifiedBlock[];

    try {
      const blocks = extractCodeBlocks(markdown);
      classified = classifyBlocks(blocks);
      if (classified.length > 0) this.lastExtractedBlocks = classified;
    } catch (err) {
      console.error("[remotion] Failed to extract code blocks:", err);
      classified = this.lastExtractedBlocks;
      if (classified.length === 0) return null;
    }

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
      markdown,
    );

    const tsStart = performance.now();
    if (version !== this.updateVersion) return null;

    // Get diagnostics directly from language service
    const syntacticDiagnostics =
      this.languageService?.getSyntacticDiagnostics(virtualFileName) || [];
    const semanticDiagnostics =
      this.languageService?.getSemanticDiagnostics(virtualFileName) || [];
    const diagnostics = [...syntacticDiagnostics, ...semanticDiagnostics];

    // Map diagnostics to markdown positions
    const markdownDiagnostics = mapDiagnosticsToMarkdown(
      diagnostics,
      synthesized.code,
      classified,
      synthesized.sceneExports,
    );

    const errorCount = markdownDiagnostics.filter(
      (d) => d.category === "error",
    ).length;

    // Get preview call locations from AST and map to markdown
    const previewLocationsRaw = getPreviewCallLocations(
      this.languageService,
      virtualFileName,
    );
    const previewLocations = mapPreviewLocationsToMarkdown(
      previewLocationsRaw,
      synthesized.code,
      markdown,
    );

    const tsEnd = performance.now();
    const endTime = performance.now();
    console.log(
      `[remotion] Typecheck: ${(tsEnd - tsStart).toFixed(1)}ms | Total: ${(endTime - startTime).toFixed(1)}ms`,
    );

    return {
      previewLocations,
      synthesizedCode: synthesized.code,
      classified,
      typecheckStatus: { status: errorCount > 0 ? "error" : "ok", errorCount },
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

}

// Backward compatibility alias (will be renamed to TypecheckManager)
export type CompilationManager = TypecheckManager;
