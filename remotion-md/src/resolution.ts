import ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Finds node_modules directories by walking up from startDir,
 * then up from rootDir. Used by both bundler and language service.
 */
export function findNodeModulesPaths(
    rootDir: string,
    startDir: string = rootDir,
): string[] {
    const paths: string[] = [];
    let current = startDir;

    // Walk up from startDir while within rootDir
    while (current.startsWith(rootDir)) {
        const candidate = path.join(current, 'node_modules');
        if (fs.existsSync(candidate)) {
            paths.push(candidate);
            break;
        }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }

    // Check rootDir itself
    const rootNodeModules = path.join(rootDir, 'node_modules');
    if (fs.existsSync(rootNodeModules) && !paths.includes(rootNodeModules)) {
        paths.push(rootNodeModules);
    }

    // Walk up beyond rootDir (for global/hoisted packages)
    current = rootDir;
    while (true) {
        const parent = path.dirname(current);
        if (parent === current) break;
        const candidate = path.join(parent, 'node_modules');
        if (fs.existsSync(candidate) && !paths.includes(candidate)) {
            paths.push(candidate);
            break;
        }
        current = parent;
    }

    return paths;
}

/**
 * Derive the real directory for module resolution from nodeModulesPaths.
 * Takes the first path (closest to file) and returns its parent directory.
 * E.g., /path/examples/node_modules -> /path/examples
 */
export function getResolutionDirectory(
    nodeModulesPaths: string[],
    fallback: string,
): string {
    return nodeModulesPaths.length > 0
        ? path.dirname(nodeModulesPaths[0])
        : fallback;
}

/**
 * Creates a TypeScript module resolver function that can be shared
 * between the compiler and language service.
 */
export function createModuleResolver(
    resolutionDirectory: string,
    compilerOptions: ts.CompilerOptions,
    host: ts.ModuleResolutionHost,
): (
    moduleNames: string[],
    containingFile: string,
) => (ts.ResolvedModuleFull | undefined)[] {
    const resolutionCache = ts.createModuleResolutionCache(
        resolutionDirectory,
        (f) => f,
    );

    return (moduleNames: string[], containingFile: string) => {
        return moduleNames.map((moduleName) => {
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
                resolutionCache,
            );

            if (resolved.resolvedModule) {
                return resolved.resolvedModule;
            }

            return undefined;
        });
    };
}
