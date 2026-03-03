import ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import { extractPreviewCallLocations, PreviewSpan } from "./previewLocations";
import {
  createModuleResolver,
  getResolutionDirectory,
  isVirtualMarkdownFileName,
  virtualMarkdownToFileName,
} from "./resolution";
import { synthesizeMarkdownModule } from "./synthesis";

export interface CompileResult {
  code: string;
  diagnostics: readonly ts.Diagnostic[];
  previewLocations: PreviewSpan[];
}

/**
 * Compile synthesized TypeScript module with support for runtime modules
 * @param fileName File name (e.g., /path/to/Example.md.tsx - derived from Example.md)
 * @param sourceText Source code to compile
 * @param nodeModulesPaths Paths to search for node_modules
 */
export function compileVirtualModule(
  fileName: string,
  sourceText: string,
  nodeModulesPaths: string[],
): CompileResult {
  if (nodeModulesPaths.length === 0) {
    throw new Error("No node_modules paths provided for compilation");
  }
  // Derive the directory for module resolution from node_modules paths
  const resolutionDirectory = getResolutionDirectory(nodeModulesPaths);

  const compilerOptions: ts.CompilerOptions = {
    jsx: ts.JsxEmit.React,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    noEmitOnError: false,
    noLib: true,
    skipLibCheck: true,
    esModuleInterop: true,
    // Enable strict type checking to catch undefined variables
    strict: true,
    noImplicitAny: true,
    noImplicitThis: true,
    strictNullChecks: true,
    strictFunctionTypes: true,
    // Don't set baseUrl - let Node resolution walk up from file location
  };

  // Create file map with only the source file
  const files = new Map<string, string>([[fileName, sourceText]]);

  const loadMarkdownModule = (virtualPath: string): string | undefined => {
    const markdownPath = virtualMarkdownToFileName(virtualPath);
    if (!markdownPath) return undefined;
    try {
      const markdownText = fs.readFileSync(markdownPath, "utf-8");
      return synthesizeMarkdownModule(markdownPath, markdownText).code;
    } catch {
      return undefined;
    }
  };

  const host: ts.CompilerHost = {
    getSourceFile: (name, languageVersion) => {
      const text = files.get(name);
      if (text !== undefined) {
        return ts.createSourceFile(name, text, languageVersion, true);
      }
      if (isVirtualMarkdownFileName(name)) {
        const synthesized = loadMarkdownModule(name);
        if (synthesized !== undefined) {
          return ts.createSourceFile(name, synthesized, languageVersion, true);
        }
      }
      // Try to read from filesystem for resolved modules
      try {
        if (fs.existsSync(name)) {
          const content = fs.readFileSync(name, "utf-8");
          return ts.createSourceFile(name, content, languageVersion, true);
        }
      } catch {
        // ignore
      }
      return undefined;
    },
    getDefaultLibFileName: (options) => {
      if (options.noLib) return "lib.d.ts";
      // Use TypeScript's built-in getDefaultLibFilePath to get proper lib files
      return ts.getDefaultLibFilePath(options);
    },
    writeFile: () => { },
    getCurrentDirectory: () => {
      // Return the real directory (not virtual path)
      // This allows TypeScript's Node resolution to walk up and find:
      // - resolutionDirectory/node_modules
      // - parent directories' node_modules (hoisted)
      return resolutionDirectory;
    },
    getDirectories: (dirPath) => {
      try {
        return fs.readdirSync(dirPath);
      } catch {
        return [];
      }
    },
    fileExists: (name) => {
      if (files.has(name)) return true;
      if (isVirtualMarkdownFileName(name)) {
        const markdownPath = virtualMarkdownToFileName(name);
        if (!markdownPath) return false;
        return fs.existsSync(markdownPath);
      }
      try {
        return fs.existsSync(name);
      } catch {
        return false;
      }
    },
    readFile: (name) => {
      if (files.has(name)) return files.get(name);
      if (isVirtualMarkdownFileName(name)) {
        const content = loadMarkdownModule(name);
        if (content === undefined) {
          throw new Error(`Failed to load virtual module: ${name}`);
        }
        return content;
      }
      try {
        return fs.readFileSync(name, "utf-8");
      } catch (err) {
        throw new Error(`Failed to read file: ${name}`);
      }
    },
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };

  // Add module resolver after host is defined
  host.resolveModuleNames = createModuleResolver(
    resolutionDirectory,
    compilerOptions,
    host,
  );

  let output = "";
  const program = ts.createProgram([fileName], compilerOptions, host);
  const sourceFile = program.getSourceFile(fileName);
  const previewLocations = sourceFile
    ? extractPreviewCallLocations(sourceFile)
    : [];
  const diagnostics = ts.getPreEmitDiagnostics(program);

  program.emit(
    undefined,
    (_fileName, text) => {
      output = text;
    },
    undefined,
    false,
    undefined,
  );

  return { code: output, diagnostics, previewLocations };
}
