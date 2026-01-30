import ts from 'typescript';
import { getRuntimeModules } from './moduleExtraction';
import * as fs from 'fs';
import * as path from 'path';

export interface CompileResult {
    code: string;
    diagnostics: readonly ts.Diagnostic[];
    runtimeModules: Set<string>;
}

/**
 * Compile virtual module with support for runtime modules
 * @param fileName Virtual file name (e.g., /virtual/path.tsx)
 * @param sourceText Source code to compile
 * @param nodeModulesPaths Paths to search for node_modules
 */
export function compileVirtualModule(
    fileName: string,
    sourceText: string,
    nodeModulesPaths: string[] = []
): CompileResult {
    // Extract runtime modules from the code
    const runtimeModules = getRuntimeModules(sourceText);

    const compilerOptions: ts.CompilerOptions = {
        jsx: ts.JsxEmit.React,
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        noEmitOnError: false,
        noLib: true,
        skipLibCheck: true,
        esModuleInterop: true,
        // Set baseUrl and paths so TypeScript searches in provided node_modules
        baseUrl: nodeModulesPaths.length > 0 ? nodeModulesPaths[0] : undefined,
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
        getDefaultLibFileName: () => 'lib.d.ts',
        writeFile: () => {},
        getCurrentDirectory: () => '/',
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
        resolveModuleNames: (moduleNames, containingFile) => {
            // Use TypeScript's built-in module resolution
            const resolutionCache = ts.createModuleResolutionCache('/', host.getCanonicalFileName);
            
            return moduleNames.map(moduleName => {
                // Use TypeScript's resolveModuleName which handles:
                // - Relative imports (./xxx, ../xxx)
                // - Node module resolution
                // - package.json main/types fields
                // - Extension resolution
                const resolved = ts.resolveModuleName(
                    moduleName,
                    containingFile,
                    compilerOptions,
                    host,
                    resolutionCache
                );
                
                if (resolved.resolvedModule) {
                    console.debug(`[compiler] ✓ Resolved ${moduleName} to ${resolved.resolvedModule.resolvedFileName}`);
                    return resolved.resolvedModule;
                }
                
                console.debug(`[compiler] ✗ Failed to resolve: ${moduleName}`);
                return undefined;
            });
        },
    };

    let output = '';
    const program = ts.createProgram([fileName], compilerOptions, host);
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

    return { code: output, diagnostics, runtimeModules };
}
