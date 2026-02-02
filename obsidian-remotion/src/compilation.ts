import { MarkdownView } from "obsidian";
import {
  extractCodeBlocks,
  classifyBlocks,
  synthesizeVirtualModule,
  mapDiagnosticsToMarkdown,
  parseBundleError,
  type ClassifiedBlock,
  type MarkdownDiagnostic,
  PreviewSpan,
  getRuntimeModules,
  extractPreviewCallLocations,
} from "remotion-md";

import { bundleVirtualModule } from "./bundler";
import path from "path";
import fs from "fs";
import type esbuild from "esbuild";
import ts from "typescript";

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

  // Language Service state
  private languageService: ts.LanguageService | null = null;
  private languageServiceHost: ts.LanguageServiceHost | null = null;
  private documentVersions = new Map<string, number>();
  private virtualFiles = new Map<string, string>();
  private lastVirtualFileName: string = "";
  private lastSynthesizedCode: string = "";
  private lastNodeModulesPaths: string[] = [];

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

    // Extract runtime modules first (needed by both TS and esbuild)
    const runtimeModules = getRuntimeModules(synthesized.code);

    // Update or create Language Service
    this.updateLanguageService(
      virtualFileName,
      synthesized.code,
      nodeModulesPaths,
    );

    // Run TypeScript diagnostics and esbuild bundling in parallel
    const tsStart = performance.now();

    const [diagnosticsResult, bundleResult] = await Promise.all([
      // TypeScript diagnostics path
      this.getTypescriptDiagnostics(virtualFileName, synthesized.code),

      // esbuild bundling path (compiles TypeScript directly)
      this.bundleTypeScriptSource(
        synthesized.code,
        virtualFileName,
        runtimeModules,
      ),
    ]);

    const tsEnd = performance.now();

    if (version !== this.updateVersion) return null;

    // Merge results from parallel execution
    let markdownDiagnostics = mapDiagnosticsToMarkdown(
      diagnosticsResult.diagnostics,
      synthesized.code,
      classified,
      synthesized.sceneExports,
    );

    const errorCount = markdownDiagnostics.filter(
      (d) => d.category === "error",
    ).length;

    // Add bundle errors to diagnostics, but don't prevent rendering
    if (bundleResult.error) {
      const bundleError_mapped = parseBundleError(
        bundleResult.error,
        classified,
      );
      if (bundleError_mapped) {
        markdownDiagnostics = [...markdownDiagnostics, bundleError_mapped];
      }
    }

    // Return diagnostics as data - let caller apply to editor
    const previewLocations = this.mapPreviewLocationsToMarkdown(
      diagnosticsResult.previewLocations,
      synthesized.code,
      activeView.editor.getValue(),
    );

    // Log performance metrics
    const endTime = performance.now();
    const totalTime = endTime - startTime;
    const tsTime = tsEnd - tsStart;
    // Note: with parallel execution, bundleTime overlaps with tsTime
    const reloadTime = endTime - tsEnd;

    console.log(
      `[remotion] Parallel execution: ${tsTime.toFixed(1)}ms | Total: ${totalTime.toFixed(1)}ms | Reload: ${reloadTime.toFixed(1)}ms`,
    );

    const bundleError = bundleResult.error
      ? bundleResult.error instanceof Error
        ? bundleResult.error.message
        : String(bundleResult.error)
      : undefined;

    return {
      previewLocations,
      bundleCode: bundleResult.code || "/* Bundle failed - see diagnostics */",
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
  ): void {
    this.lastVirtualFileName = virtualFileName;
    this.lastSynthesizedCode = sourceText;
    this.lastNodeModulesPaths = nodeModulesPaths;

    // Update virtual files map
    this.virtualFiles.set(virtualFileName, sourceText);

    // Increment document version
    const currentVersion = this.documentVersions.get(virtualFileName) || 0;
    this.documentVersions.set(virtualFileName, currentVersion + 1);

    // Create or update Language Service
    if (!this.languageService || !this.languageServiceHost) {
      this.languageService = this.createLanguageService(
        virtualFileName,
        sourceText,
        nodeModulesPaths,
      );
    }
  }

  private createLanguageService(
    virtualFileName: string,
    sourceText: string,
    nodeModulesPaths: string[],
  ): ts.LanguageService {
    const resolutionDirectory =
      nodeModulesPaths.length > 0
        ? path.dirname(nodeModulesPaths[0])
        : path.dirname(virtualFileName);

    const compilerOptions: ts.CompilerOptions = {
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      noLib: false,
      skipLibCheck: true,
      esModuleInterop: true,
      strict: true,
      noImplicitAny: true,
      noImplicitThis: true,
      strictNullChecks: true,
      strictFunctionTypes: true,
    };

    this.languageServiceHost = {
      getScriptFileNames: () => Array.from(this.virtualFiles.keys()),
      getScriptVersion: (fileName) =>
        String(this.documentVersions.get(fileName) || 0),
      getScriptSnapshot: (fileName) => {
        const text = this.virtualFiles.get(fileName);
        if (text !== undefined) {
          return ts.ScriptSnapshot.fromString(text);
        }
        // Try reading from filesystem
        try {
          if (fs.existsSync(fileName)) {
            const content = fs.readFileSync(fileName, "utf-8");
            return ts.ScriptSnapshot.fromString(content);
          }
        } catch {
          // ignore
        }
        return undefined;
      },
      getCurrentDirectory: () => resolutionDirectory,
      getCompilationSettings: () => compilerOptions,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: (fileName) => {
        if (this.virtualFiles.has(fileName)) return true;
        try {
          return fs.existsSync(fileName);
        } catch {
          return false;
        }
      },
      readFile: (fileName) => {
        if (this.virtualFiles.has(fileName)) {
          return this.virtualFiles.get(fileName);
        }
        try {
          return fs.readFileSync(fileName, "utf-8");
        } catch {
          return undefined;
        }
      },
      resolveModuleNames: (moduleNames, containingFile) => {
        const currentDir = resolutionDirectory;
        const resolutionCache = ts.createModuleResolutionCache(
          currentDir,
          (fileName) => fileName,
        );

        const realContainingFile = containingFile.startsWith("/virtual/")
          ? path.join(currentDir, path.basename(containingFile))
          : containingFile;

        return moduleNames.map((moduleName) => {
          const resolved = ts.resolveModuleName(
            moduleName,
            realContainingFile,
            compilerOptions,
            {
              fileExists: this.languageServiceHost!.fileExists!,
              readFile: this.languageServiceHost!.readFile!,
            },
            resolutionCache,
          );

          if (resolved.resolvedModule) {
            return resolved.resolvedModule;
          }

          return undefined;
        });
      },
    };

    return ts.createLanguageService(
      this.languageServiceHost,
      ts.createDocumentRegistry(),
    );
  }

  private async getTypescriptDiagnostics(
    virtualFileName: string,
    sourceText: string,
  ): Promise<{
    diagnostics: readonly ts.Diagnostic[];
    previewLocations: PreviewSpan[];
  }> {
    try {
      if (!this.languageService) {
        throw new Error("Language Service not initialized");
      }

      // Get diagnostics from Language Service
      const syntacticDiagnostics =
        this.languageService.getSyntacticDiagnostics(virtualFileName);
      const semanticDiagnostics =
        this.languageService.getSemanticDiagnostics(virtualFileName);
      const diagnostics = [...syntacticDiagnostics, ...semanticDiagnostics];

      // Extract preview locations from source
      const program = this.languageService.getProgram();
      const sourceFile = program?.getSourceFile(virtualFileName);
      const previewLocations = sourceFile
        ? extractPreviewCallLocations(sourceFile)
        : [];

      return { diagnostics, previewLocations };
    } catch (err) {
      console.error("[remotion] TypeScript diagnostics failed:", err);
      return { diagnostics: [], previewLocations: [] };
    }
  }

  private async bundleTypeScriptSource(
    sourceText: string,
    virtualFileName: string,
    runtimeModules: Set<string>,
  ): Promise<{ code: string; error?: Error }> {
    if (!this.esbuildInstance) {
      const error = new Error("esbuild not available");
      return {
        code: "/* esbuild not found - install esbuild in your vault */",
        error,
      };
    }

    try {
      // Pass TypeScript source directly to esbuild
      const result = await bundleVirtualModule(
        sourceText,
        virtualFileName,
        this.esbuildInstance,
        runtimeModules,
      );
      return result;
    } catch (err) {
      console.error("[remotion] Bundle failed:", err);
      return {
        code: "/* Bundle failed - see console */",
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }

  private mapPreviewLocationsToMarkdown(
    locations: PreviewSpan[],
    synthCode: string,
    markdownText: string,
  ): PreviewSpan[] {
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

    const buildLineStarts = (text: string): number[] => {
      const starts = [0];
      for (let i = 0; i < text.length; i++) {
        if (text[i] === "\n") starts.push(i + 1);
      }
      return starts;
    };

    const getLineAndColumnFromPos = (
      lineStarts: number[],
      pos: number,
    ): { line: number; column: number } => {
      let low = 0;
      let high = lineStarts.length - 1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const start = lineStarts[mid];
        const next =
          mid + 1 < lineStarts.length
            ? lineStarts[mid + 1]
            : Number.MAX_SAFE_INTEGER;
        if (pos >= start && pos < next) {
          return { line: mid + 1, column: pos - start };
        }
        if (pos < start) {
          high = mid - 1;
        } else {
          low = mid + 1;
        }
      }
      const last = lineStarts.length - 1;
      return { line: last + 1, column: Math.max(0, pos - lineStarts[last]) };
    };

    const synthLineStarts = buildLineStarts(synthCode);
    const mdLineStarts = buildLineStarts(markdownText);

    return locations.map((loc) => {
      const markdownLine = mapSynthLineToMarkdownLine(loc.line);
      const startPos = (mdLineStarts[markdownLine - 1] ?? 0) + loc.column;
      const synthEndPos = (loc.pos ?? 0) + (loc.length ?? 0);
      const endLineCol = getLineAndColumnFromPos(synthLineStarts, synthEndPos);
      const markdownEndLine = mapSynthLineToMarkdownLine(endLineCol.line);
      const endPos =
        (mdLineStarts[markdownEndLine - 1] ?? startPos) + endLineCol.column;
      const length = Math.max(0, endPos - startPos);

      return {
        line: markdownLine,
        column: loc.column,
        text: loc.text,
        pos: startPos,
        length,
      };
    });
  }

  getLastExtractedBlocks(): ClassifiedBlock[] {
    return this.lastExtractedBlocks;
  }

  getCurrentVersion(): number {
    return this.updateVersion;
  }

  /**
   * Map markdown cursor position to virtual TSX position
   * Returns null if cursor is not inside a code block
   */
  mapMarkdownPositionToVirtual(
    markdownLine: number,
    markdownColumn: number,
    markdownText: string,
  ): { line: number; column: number } | null {
    if (!this.lastSynthesizedCode) {
      return null;
    }

    const synthLines = this.lastSynthesizedCode.split("\n");
    const sentinelRegex = /^\/\/ --- block \d+ @ .*:(\d+) ---$/;

    // Build a map of sentinel lines to block start lines
    const blockMap: Array<{
      synthStartLine: number; // Line in TSX after sentinel + blank line
      markdownFenceLine: number; // Line in markdown where fence (```) is (1-indexed)
      synthSentinelLine: number; // Line where sentinel comment is
    }> = [];

    for (let i = 0; i < synthLines.length; i++) {
      const match = synthLines[i].match(sentinelRegex);
      if (match) {
        // Sentinel contains line number of the fence (```) in markdown (1-indexed)
        const markdownFenceLine = Number(match[1]);
        const synthStartLine = i + 1 + 2; // sentinel + blank line + content starts
        blockMap.push({
          synthStartLine,
          markdownFenceLine,
          synthSentinelLine: i,
        });
      }
    }

    // Find which block the markdown position is in
    let targetBlock: (typeof blockMap)[0] | null = null;
    let nextBlock: (typeof blockMap)[0] | null = null;

    for (let i = 0; i < blockMap.length; i++) {
      const block = blockMap[i];
      // Code content starts one line after the fence
      const markdownContentStartLine = block.markdownFenceLine + 1;
      if (markdownLine >= markdownContentStartLine) {
        targetBlock = block;
        nextBlock = blockMap[i + 1] || null;
      } else {
        break;
      }
    }

    if (!targetBlock) {
      return null; // Cursor is before any code blocks
    }

    // Calculate TSX position
    // Code content starts one line after the fence in markdown
    const markdownContentStartLine = targetBlock.markdownFenceLine + 1;
    const lineOffset = markdownLine - markdownContentStartLine;
    const tsxLine = targetBlock.synthStartLine + lineOffset;

    // Check if we're past the end of this block (before next block's sentinel)
    if (nextBlock && tsxLine >= nextBlock.synthSentinelLine) {
      return null; // Cursor is between blocks
    }

    return {
      line: tsxLine,
      column: markdownColumn,
    };
  }

  /**
   * Get completions at a markdown position
   */
  async getCompletionsAtPosition(
    view: MarkdownView,
    markdownPos: number,
    prefix?: string,
  ): Promise<ts.CompletionEntry[]> {
    if (!this.languageService || !view.file) {
      return [];
    }

    const markdownText = view.editor.getValue();
    const { line, column } = this.posToLineColumn(markdownText, markdownPos);

    const virtualPos = this.mapMarkdownPositionToVirtual(
      line,
      column,
      markdownText,
    );

    if (!virtualPos || !this.lastSynthesizedCode) {
      return [];
    }

    // Convert line/column to offset in virtual file
    const virtualOffset = this.lineColumnToPos(
      this.lastSynthesizedCode,
      virtualPos.line,
      virtualPos.column,
    );

    try {
      const completions = this.languageService.getCompletionsAtPosition(
        this.lastVirtualFileName,
        virtualOffset,
        { includeCompletionsWithInsertText: true },
      );

      if (!completions) {
        return [];
      }

      // If we have a prefix, let TypeScript filter the results
      let entries = completions.entries;
      if (prefix && prefix.length > 0) {
        entries = entries.filter((entry) =>
          entry.name.toLowerCase().startsWith(prefix.toLowerCase()),
        );
      }

      return entries;
    } catch (err) {
      console.error("[remotion] Completions failed:", err);
      return [];
    }
  }

  /**
   * Get quick info (hover type information) at a markdown position
   */
  async getQuickInfoAtPosition(
    view: MarkdownView,
    markdownPos: number,
  ): Promise<{
    displayParts: ts.SymbolDisplayPart[];
    documentation: ts.SymbolDisplayPart[];
  } | null> {
    if (!this.languageService || !view.file) {
      return null;
    }

    const markdownText = view.editor.getValue();
    const { line, column } = this.posToLineColumn(markdownText, markdownPos);

    const virtualPos = this.mapMarkdownPositionToVirtual(
      line,
      column,
      markdownText,
    );

    if (!virtualPos || !this.lastSynthesizedCode) {
      return null;
    }

    // Convert line/column to offset in virtual file
    const virtualOffset = this.lineColumnToPos(
      this.lastSynthesizedCode,
      virtualPos.line,
      virtualPos.column,
    );

    try {
      const quickInfo = this.languageService.getQuickInfoAtPosition(
        this.lastVirtualFileName,
        virtualOffset,
      );

      if (!quickInfo) {
        return null;
      }

      // Return structured data for syntax highlighting
      return {
        displayParts: quickInfo.displayParts || [],
        documentation: quickInfo.documentation || [],
      };
    } catch (err) {
      console.error("[remotion] Quick info failed:", err);
      return null;
    }
  }

  /**
   * Get definition location at a markdown position
   */
  async getDefinitionAtPosition(
    view: MarkdownView,
    markdownPos: number,
  ): Promise<{ filePath: string; line: number; column: number } | null> {
    if (!this.languageService || !view.file) {
      return null;
    }

    const markdownText = view.editor.getValue();
    const { line, column } = this.posToLineColumn(markdownText, markdownPos);

    const virtualPos = this.mapMarkdownPositionToVirtual(
      line,
      column,
      markdownText,
    );

    if (!virtualPos || !this.lastSynthesizedCode) {
      return null;
    }

    // Convert line/column to offset in virtual file
    const virtualOffset = this.lineColumnToPos(
      this.lastSynthesizedCode,
      virtualPos.line,
      virtualPos.column,
    );

    try {
      const definitions = this.languageService.getDefinitionAtPosition(
        this.lastVirtualFileName,
        virtualOffset,
      );

      if (!definitions || definitions.length === 0) {
        return null;
      }

      const def = definitions[0];

      // Convert back to markdown coordinates if it's in the same virtual file
      if (def.fileName === this.lastVirtualFileName) {
        const defLineCol = this.posToLineColumn(
          this.lastSynthesizedCode,
          def.textSpan.start,
        );

        // Map back to markdown (inverse of mapMarkdownPositionToVirtual)
        const markdownLine = this.mapVirtualLineToMarkdown(defLineCol.line);

        return {
          filePath: view.file.path,
          line: markdownLine,
          column: defLineCol.column,
        };
      }

      // For definitions in other files, return the file path
      return {
        filePath: def.fileName,
        line: def.textSpan.start,
        column: 0,
      };
    } catch (err) {
      console.error("[remotion] Definition lookup failed:", err);
      return null;
    }
  }

  private mapVirtualLineToMarkdown(virtualLine: number): number {
    if (!this.lastSynthesizedCode) {
      return virtualLine;
    }

    const synthLines = this.lastSynthesizedCode.split("\n");
    const sentinelRegex = /^\/\/ --- block \d+ @ .*:(\d+) ---$/;

    let currentBlock: {
      synthStartLine: number;
      markdownFenceLine: number;
    } | null = null;

    for (let i = 0; i < synthLines.length; i++) {
      const match = synthLines[i].match(sentinelRegex);
      if (match) {
        // Sentinel contains line number of the fence (```) in markdown (1-indexed)
        const markdownFenceLine = Number(match[1]);
        const synthStartLine = i + 1 + 2;

        if (synthStartLine <= virtualLine) {
          currentBlock = { synthStartLine, markdownFenceLine };
        } else {
          break;
        }
      }
    }

    if (!currentBlock) {
      return virtualLine;
    }

    const lineOffset = virtualLine - currentBlock.synthStartLine;
    // Code content starts one line after the fence
    return currentBlock.markdownFenceLine + 1 + lineOffset;
  }

  private posToLineColumn(
    text: string,
    pos: number,
  ): { line: number; column: number } {
    const lines = text.substring(0, pos).split("\n");
    return {
      line: lines.length,
      column: lines[lines.length - 1].length,
    };
  }

  private lineColumnToPos(text: string, line: number, column: number): number {
    const lines = text.split("\n");
    let pos = 0;

    for (let i = 0; i < line - 1 && i < lines.length; i++) {
      pos += lines[i].length + 1; // +1 for newline
    }

    pos += Math.min(column, lines[line - 1]?.length || 0);
    return pos;
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
