import ts from "typescript";
import * as path from "path";
import * as fs from "fs";

const MARKDOWN_EXTENSION = ".md";
const MARKDOWN_VIRTUAL_SUFFIX = ".md.tsx";

export function toVirtualMarkdownFileName(mdPath: string): string {
  return `${mdPath}.tsx`;
}

export function isVirtualMarkdownFileName(fileName: string): boolean {
  return fileName.endsWith(MARKDOWN_VIRTUAL_SUFFIX);
}

export function virtualMarkdownToFileName(fileName: string): string | null {
  if (!isVirtualMarkdownFileName(fileName)) return null;
  return fileName.slice(0, -".tsx".length);
}

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
    const candidate = path.join(current, "node_modules");
    if (fs.existsSync(candidate)) {
      paths.push(candidate);
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // Check rootDir itself
  const rootNodeModules = path.join(rootDir, "node_modules");
  if (fs.existsSync(rootNodeModules) && !paths.includes(rootNodeModules)) {
    paths.push(rootNodeModules);
  }

  // Walk up beyond rootDir (for global/hoisted packages)
  current = rootDir;
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

/**
 * Derive the real directory for module resolution from nodeModulesPaths.
 * Takes the first path (closest to file) and returns its parent directory.
 * E.g., /path/examples/node_modules -> /path/examples
 * Throws if no node_modules found.
 */
export function getResolutionDirectory(
  nodeModulesPaths: string[],
): string {
  if (nodeModulesPaths.length === 0) {
    throw new Error(
      "No node_modules found in vault or parent directories. Install dependencies first."
    );
  }
  return path.dirname(nodeModulesPaths[0]);
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
        const resolvedModule = resolved.resolvedModule;
        if (resolvedModule.resolvedFileName.endsWith(MARKDOWN_EXTENSION)) {
          return {
            ...resolvedModule,
            resolvedFileName: toVirtualMarkdownFileName(
              resolvedModule.resolvedFileName,
            ),
            extension: ts.Extension.Tsx,
          };
        }
        return resolvedModule;
      }

      return undefined;
    });
  };
}
