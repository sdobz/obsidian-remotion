import ts from 'typescript';
import { getRuntimeModules } from './moduleExtraction';
import * as fs from 'fs';
import * as path from 'path';
import { extractPreviewCallLocations, PreviewSpan } from 'previewLocations';
import { getResolutionDirectory, createModuleResolver } from './resolution';

export interface CompileResult {
    code: string;
    diagnostics: readonly ts.Diagnostic[];
    runtimeModules: Set<string>;
    previewLocations: PreviewSpan[];
}

/**
 * Compile synthesized TypeScript module with support for runtime modules
 * @param fileName File name (e.g., /path/to/Example.md.tsx - derived from Example.md)
 * @param sourceText Source code to compile
 * @param nodeModulesPaths Paths to search for node_modules
 * @param options Compilation options
 */
export function compileVirtualModule(
    fileName: string,
    sourceText: string,
    nodeModulesPaths: string[] = [],
    options: { includeLib?: boolean } = {}
): CompileResult {
    // Extract runtime modules from the code
    const runtimeModules = getRuntimeModules(sourceText);

    // Derive the directory for module resolution from the file's location
    const resolutionDirectory = getResolutionDirectory(nodeModulesPaths, path.dirname(fileName));

    const compilerOptions: ts.CompilerOptions = {
        jsx: ts.JsxEmit.React,
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        noEmitOnError: false,
        noLib: !options.includeLib, // Allow lib types for CLI usage
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

    const host: ts.CompilerHost = {
        getSourceFile: (name, languageVersion) => {
            const text = files.get(name);
            if (text !== undefined) {
                return ts.createSourceFile(name, text, languageVersion, true);
            }
            // Try to read from filesystem for resolved modules
            try {
                if (fs.existsSync(name)) {
                    const content = fs.readFileSync(name, 'utf-8');
                    return ts.createSourceFile(name, content, languageVersion, true);
                }
            } catch {
                // ignore
            }
            return undefined;
        },
        getDefaultLibFileName: (options) => {
            if (options.noLib) return 'lib.d.ts';
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
            try {
                return fs.existsSync(name);
            } catch {
                return false;
            }
        },
        readFile: (name) => {
            if (files.has(name)) return files.get(name);
            try {
                return fs.readFileSync(name, 'utf-8');
            } catch {
                return undefined;
            }
        },
        getCanonicalFileName: (name) => name,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => '\n',
    };

    // Add module resolver after host is defined
    host.resolveModuleNames = createModuleResolver(
        resolutionDirectory,
        compilerOptions,
        host
    );


    let output = '';
    const program = ts.createProgram([fileName], compilerOptions, host);
    const sourceFile = program.getSourceFile(fileName);
    const previewLocations = sourceFile ? extractPreviewCallLocations(sourceFile) : [];
    const diagnostics = ts.getPreEmitDiagnostics(program);

    program.emit(
        undefined,
        (_fileName, text) => {
            output = text;
        },
        undefined,
        false,
        undefined
    );

    return { code: output, diagnostics, runtimeModules, previewLocations };
}
