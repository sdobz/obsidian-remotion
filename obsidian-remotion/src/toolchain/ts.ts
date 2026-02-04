import ts from "typescript";
import type { MarkdownView } from "obsidian";
import { extractPreviewCallLocations, type PreviewSpan } from "remotion-md";
import fs from "fs";
import path from "path";

interface BlockMap {
  synthStartLine: number;
  markdownFenceLine: number;
  synthSentinelLine: number;
}

const SENTINEL_REGEX = /^\/\/ --- block \d+ @ .*:(\d+) ---$/;

function buildBlockMap(synthCode: string): BlockMap[] {
  const synthLines = synthCode.split("\n");
  const blockMap: BlockMap[] = [];
  for (let i = 0; i < synthLines.length; i++) {
    const match = synthLines[i].match(SENTINEL_REGEX);
    if (match) {
      const markdownFenceLine = Number(match[1]);
      const synthStartLine = i + 1 + 2;
      blockMap.push({
        synthStartLine,
        markdownFenceLine,
        synthSentinelLine: i,
      });
    }
  }
  return blockMap;
}

function posToLineColumn(
  text: string,
  pos: number,
): { line: number; column: number } {
  const lines = text.substring(0, pos).split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length };
}

function lineColumnToPos(text: string, line: number, column: number): number {
  const lines = text.split("\n");
  let pos = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) {
    pos += lines[i].length + 1;
  }
  pos += Math.min(column, lines[line - 1]?.length || 0);
  return pos;
}

function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function getLineAndColumnFromPos(
  lineStarts: number[],
  pos: number,
): { line: number; column: number } {
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
    if (pos < start) high = mid - 1;
    else low = mid + 1;
  }
  const last = lineStarts.length - 1;
  return { line: last + 1, column: Math.max(0, pos - lineStarts[last]) };
}

/**
 * Encapsulates coordinate mapping between markdown and virtual TSX files.
 * Caches block map and line starts for efficient repeated queries.
 */
class CoordinateMapper {
  private blockMap: BlockMap[];
  private synthLineStarts: number[];

  constructor(synthCode: string) {
    this.blockMap = buildBlockMap(synthCode);
    this.synthLineStarts = buildLineStarts(synthCode);
  }

  markdownToVirtual(
    markdownLine: number,
    markdownColumn: number,
  ): { line: number; column: number } | null {
    let targetBlock: BlockMap | null = null;
    let nextBlock: BlockMap | null = null;

    for (let i = 0; i < this.blockMap.length; i++) {
      const block = this.blockMap[i];
      const markdownContentStartLine = block.markdownFenceLine + 1;
      if (markdownLine >= markdownContentStartLine) {
        targetBlock = block;
        nextBlock = this.blockMap[i + 1] || null;
      } else break;
    }
    if (!targetBlock) return null;

    const markdownContentStartLine = targetBlock.markdownFenceLine + 1;
    const lineOffset = markdownLine - markdownContentStartLine;
    const tsxLine = targetBlock.synthStartLine + lineOffset;

    if (nextBlock && tsxLine >= nextBlock.synthSentinelLine) return null;
    return { line: tsxLine, column: markdownColumn };
  }

  virtualLineToMarkdown(virtualLine: number): number {
    let currentBlock: BlockMap | null = null;
    for (const block of this.blockMap) {
      if (block.synthStartLine <= virtualLine) currentBlock = block;
      else break;
    }
    if (!currentBlock) return virtualLine;
    const lineOffset = virtualLine - currentBlock.synthStartLine;
    return currentBlock.markdownFenceLine + 1 + lineOffset;
  }

  mapPreviewLocations(
    locations: PreviewSpan[],
    markdownText: string,
  ): PreviewSpan[] {
    const mdLineStarts = buildLineStarts(markdownText);

    const mapSynthLineToMarkdownLine = (synthLine: number): number => {
      let current = this.blockMap[0];
      for (const entry of this.blockMap) {
        if (entry.synthStartLine <= synthLine) current = entry;
        else break;
      }
      if (!current) return synthLine;
      return current.markdownFenceLine + (synthLine - current.synthStartLine);
    };

    return locations.map((loc) => {
      const markdownLine = mapSynthLineToMarkdownLine(loc.line);
      const startPos = (mdLineStarts[markdownLine - 1] ?? 0) + loc.column;
      const synthEndPos = (loc.pos ?? 0) + (loc.length ?? 0);
      const endLineCol = getLineAndColumnFromPos(
        this.synthLineStarts,
        synthEndPos,
      );
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
}

export function mapPreviewLocationsToMarkdown(
  locations: PreviewSpan[],
  synthCode: string,
  markdownText: string,
): PreviewSpan[] {
  const mapper = new CoordinateMapper(synthCode);
  return mapper.mapPreviewLocations(locations, markdownText);
}

export function createLanguageService(
  virtualFileName: string,
  nodeModulesPaths: string[],
  virtualFiles: Map<string, string>,
  documentVersions: Map<string, number>,
): {
  languageService: ts.LanguageService;
  languageServiceHost: ts.LanguageServiceHost;
} {
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

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => Array.from(virtualFiles.keys()),
    getScriptVersion: (fileName) => String(documentVersions.get(fileName) || 0),
    getScriptSnapshot: (fileName) => {
      const text = virtualFiles.get(fileName);
      if (text !== undefined) return ts.ScriptSnapshot.fromString(text);
      try {
        if (fs.existsSync(fileName)) {
          return ts.ScriptSnapshot.fromString(
            fs.readFileSync(fileName, "utf-8"),
          );
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
      if (virtualFiles.has(fileName)) return true;
      try {
        return fs.existsSync(fileName);
      } catch {
        return false;
      }
    },
    readFile: (fileName) => {
      if (virtualFiles.has(fileName)) return virtualFiles.get(fileName);
      try {
        return fs.readFileSync(fileName, "utf-8");
      } catch {
        return undefined;
      }
    },
    resolveModuleNames: (moduleNames, containingFile) => {
      const resolutionCache = ts.createModuleResolutionCache(
        resolutionDirectory,
        (f) => f,
      );
      const realContainingFile = containingFile.startsWith("/virtual/")
        ? path.join(resolutionDirectory, path.basename(containingFile))
        : containingFile;

      return moduleNames.map((moduleName) => {
        const resolved = ts.resolveModuleName(
          moduleName,
          realContainingFile,
          compilerOptions,
          {
            fileExists: host.fileExists!,
            readFile: host.readFile!,
          },
          resolutionCache,
        );
        return resolved.resolvedModule;
      });
    },
  };

  return {
    languageService: ts.createLanguageService(
      host,
      ts.createDocumentRegistry(),
    ),
    languageServiceHost: host,
  };
}

/**
 * Extracts Remotion preview call locations from the virtual module.
 * Uses the TypeScript AST to find @preview() calls.
 */
export function getPreviewCallLocations(
  languageService: ts.LanguageService | null,
  virtualFileName: string,
): PreviewSpan[] {
  if (!languageService) return [];
  try {
    const program = languageService.getProgram();
    const sourceFile = program?.getSourceFile(virtualFileName);
    return sourceFile ? extractPreviewCallLocations(sourceFile) : [];
  } catch (err) {
    console.error("[remotion] Preview extraction failed:", err);
    return [];
  }
}

/**
 * Wraps TypeScript language service queries with automatic coordinate mapping.
 * Reduces parameter passing by caching state (service, virtualFileName, mapper).
 */
export class LanguageServiceQueries {
  private languageService: ts.LanguageService | null;
  private virtualFileName: string;
  private mapper: CoordinateMapper;
  private synthCode: string;

  constructor(
    languageService: ts.LanguageService | null,
    virtualFileName: string,
    synthCode: string,
  ) {
    this.languageService = languageService;
    this.virtualFileName = virtualFileName;
    this.synthCode = synthCode;
    this.mapper = new CoordinateMapper(synthCode);
  }

  private mapToVirtualOffset(
    markdownText: string,
    markdownPos: number,
  ): number | null {
    const { line, column } = posToLineColumn(markdownText, markdownPos);
    const virtualPos = this.mapper.markdownToVirtual(line, column);
    if (!virtualPos) return null;
    return lineColumnToPos(this.synthCode, virtualPos.line, virtualPos.column);
  }

  async getCompletions(
    markdownText: string,
    markdownPos: number,
    prefix?: string,
  ): Promise<ts.CompletionEntry[]> {
    if (!this.languageService) return [];
    const virtualOffset = this.mapToVirtualOffset(markdownText, markdownPos);
    if (virtualOffset === null) return [];
    try {
      const completions = this.languageService.getCompletionsAtPosition(
        this.virtualFileName,
        virtualOffset,
        { includeCompletionsWithInsertText: true },
      );
      if (!completions) return [];
      let entries = completions.entries;
      if (prefix && prefix.length > 0) {
        entries = entries.filter((e) =>
          e.name.toLowerCase().startsWith(prefix.toLowerCase()),
        );
      }
      return entries;
    } catch (err) {
      console.error("[remotion] Completions failed:", err);
      return [];
    }
  }

  async getQuickInfo(
    markdownText: string,
    markdownPos: number,
  ): Promise<{
    displayParts: ts.SymbolDisplayPart[];
    documentation: ts.SymbolDisplayPart[];
  } | null> {
    if (!this.languageService) return null;
    const virtualOffset = this.mapToVirtualOffset(markdownText, markdownPos);
    if (virtualOffset === null) return null;
    try {
      const quickInfo = this.languageService.getQuickInfoAtPosition(
        this.virtualFileName,
        virtualOffset,
      );
      if (!quickInfo) return null;
      return {
        displayParts: quickInfo.displayParts || [],
        documentation: quickInfo.documentation || [],
      };
    } catch (err) {
      console.error("[remotion] Quick info failed:", err);
      return null;
    }
  }

  async getDefinition(
    markdownText: string,
    markdownPos: number,
  ): Promise<{ filePath: string; line: number; column: number } | null> {
    if (!this.languageService) return null;
    const virtualOffset = this.mapToVirtualOffset(markdownText, markdownPos);
    if (virtualOffset === null) return null;
    try {
      const definitions = this.languageService.getDefinitionAtPosition(
        this.virtualFileName,
        virtualOffset,
      );
      if (!definitions || definitions.length === 0) return null;
      const def = definitions[0];
      if (def.fileName === this.virtualFileName) {
        const defLineCol = posToLineColumn(this.synthCode, def.textSpan.start);
        const markdownLine = this.mapper.virtualLineToMarkdown(defLineCol.line);
        return {
          filePath: "",
          line: markdownLine,
          column: defLineCol.column,
        };
      }
      return { filePath: def.fileName, line: def.textSpan.start, column: 0 };
    } catch (err) {
      console.error("[remotion] Definition lookup failed:", err);
      return null;
    }
  }
}

// Public API: Export wrapped functions that use the class
export async function getCompletionsAtPosition(
  languageService: ts.LanguageService | null,
  view: MarkdownView | null,
  virtualFileName: string,
  markdownPos: number,
  synthCode: string,
  prefix?: string,
): Promise<ts.CompletionEntry[]> {
  if (!languageService || !view) return [];
  const queries = new LanguageServiceQueries(
    languageService,
    virtualFileName,
    synthCode,
  );
  return queries.getCompletions(view.editor.getValue(), markdownPos, prefix);
}

export async function getQuickInfoAtPosition(
  languageService: ts.LanguageService | null,
  view: MarkdownView | null,
  virtualFileName: string,
  markdownPos: number,
  synthCode: string,
): Promise<{
  displayParts: ts.SymbolDisplayPart[];
  documentation: ts.SymbolDisplayPart[];
} | null> {
  if (!languageService || !view) return null;
  const queries = new LanguageServiceQueries(
    languageService,
    virtualFileName,
    synthCode,
  );
  return queries.getQuickInfo(view.editor.getValue(), markdownPos);
}

export async function getDefinitionAtPosition(
  languageService: ts.LanguageService | null,
  view: MarkdownView | null,
  virtualFileName: string,
  markdownPos: number,
  synthCode: string,
): Promise<{ filePath: string; line: number; column: number } | null> {
  if (!languageService || !view) return null;
  const queries = new LanguageServiceQueries(
    languageService,
    virtualFileName,
    synthCode,
  );
  const result = await queries.getDefinition(
    view.editor.getValue(),
    markdownPos,
  );
  if (result && view.file) {
    result.filePath = view.file.path;
  }
  return result;
}
