import type esbuild from "esbuild";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  createModuleResolver,
  isVirtualMarkdownFileName,
  synthesizeMarkdownModule,
  virtualMarkdownToFileName,
} from "remotion-md";
import { ResolutionContext } from "./resolution-context";

export interface BundleResult {
  code: string;
  error?: Error;
  bundledModules?: Set<string>;
}

/**
 * Plugin factory functions for testability
 * Each plugin encapsulates one concern and can be tested independently
 */
export namespace PluginFactories {
  /**
   * Create markdown loader plugin for .md files
   * Synthesizes markdown into TypeScript that esbuild can bundle
   */
  export function createMarkdownLoaderPlugin(
    readMarkdownText: (markdownPath: string) => string | undefined,
  ): esbuild.Plugin {
    return {
      name: "markdown-loader",
      setup(build) {
        build.onLoad({ filter: /\.md$/ }, (args) => {
          const markdownText = readMarkdownText(args.path);
          if (!markdownText) {
            return { errors: [{ text: `Failed to load ${args.path}` }] };
          }
          try {
            const synthesized = synthesizeMarkdownModule(args.path, markdownText);
            return {
              contents: synthesized.code,
              loader: "tsx",
              resolveDir: path.dirname(args.path),
            };
          } catch (err) {
            return {
              errors: [
                {
                  text:
                    err instanceof Error ? err.message : "Failed to synthesize markdown",
                },
              ],
            };
          }
        });
      },
    };
  }

  /**
   * Create virtual entry point plugin
   */
  export function createVirtualEntryPlugin(
    entryCode: string,
    entryName: string,
  ): esbuild.Plugin {
    return {
      name: "virtual-entry",
      setup(build) {
        build.onResolve({ filter: /^virtual-entry$/ }, () => ({
          path: entryName,
          namespace: "virtual",
        }));
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.path === entryName) {
            return { path: args.path, namespace: "virtual" };
          }
          return null;
        });
        build.onLoad({ filter: /.*/, namespace: "virtual" }, (args) => {
          if (args.path === entryName) {
            return {
              contents: entryCode,
              loader: "tsx",
              resolveDir: path.dirname(entryName),
            };
          }
          return null;
        });
      },
    };
  }

  /**
   * Create TypeScript module resolver plugin
   */
  export function createTsResolvePlugin(
    resolvedModules: (ts.ResolvedModuleFull | undefined)[],
    entryName: string,
    readMarkdownText: (markdownPath: string) => string | undefined,
  ): esbuild.Plugin {
    return {
      name: "ts-resolve",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.path === "virtual-entry" || args.path === entryName) {
            return null;
          }
          const isRelativeOrAbsolute =
            args.path.startsWith(".") || args.path.startsWith("/");
          if (!isRelativeOrAbsolute) return null;
          // Resolve relative paths using TypeScript resolver results
          const resolved = resolvedModules.find(
            (r) => r && r.resolvedFileName && !r.isExternalLibraryImport,
          );
          if (!resolved) return null;
          return { path: resolved.resolvedFileName };
        });

        build.onLoad({ filter: /\.md\.tsx$/ }, (args) => {
          const markdownPath = virtualMarkdownToFileName(args.path);
          if (!markdownPath) return null;
          try {
            const markdownText = readMarkdownText(markdownPath);
            if (markdownText === undefined) {
              return {
                errors: [
                  {
                    text: `Markdown not found on disk: ${markdownPath}`,
                  },
                ],
              };
            }
            const synthesized = synthesizeMarkdownModule(
              markdownPath,
              markdownText,
            );
            return { contents: synthesized.code, loader: "tsx" };
          } catch (err) {
            return {
              errors: [
                {
                  text:
                    err instanceof Error
                      ? err.message
                      : "Failed to load markdown",
                },
              ],
            };
          }
        });
      },
    };
  }

  /**
   * Create multi-path npm package resolver plugin
   * Searches multiple node_modules directories
   */
  export function createMultiPathResolvePlugin(
    nodeModulesPaths: string[],
  ): esbuild.Plugin {
    return {
      name: "multi-path-resolve",
      setup(build) {
        // Resolve npm packages (not relative/absolute paths)
        build.onResolve(
          { filter: /^(@[a-zA-Z0-9-]+\/)?[a-zA-Z0-9-_.]+/ },
          (args) => {
            // Skip if relative or absolute
            if (args.path.startsWith(".") || args.path.startsWith("/")) {
              return null;
            }

            // Extract the base package name
            let basePkgName = args.path.split("/")[0];
            if (basePkgName.startsWith("@")) {
              basePkgName = args.path.split("/").slice(0, 2).join("/");
            }

            // Try each node_modules path
            for (const modulesPath of nodeModulesPaths) {
              const pkgDir = path.join(modulesPath, basePkgName);
              if (!fs.existsSync(pkgDir)) continue;

              const entryPoint = findPackageEntryPoint(pkgDir);
              if (entryPoint) {
                return { path: entryPoint };
              }
            }

            return null;
          },
        );
      },
    };
  }

  /**
   * Create npm package externalization plugin
   * Marks all npm packages as external (for user code bundling)
   */
  export function createExternalizePackagesPlugin(): esbuild.Plugin {
    const builtins = [
      "fs",
      "path",
      "os",
      "crypto",
      "util",
      "stream",
      "events",
    ];
    return {
      name: "externalize-packages",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          const p = args.path;
          if (
            p.startsWith(".") ||
            p.startsWith("/") ||
            builtins.includes(p)
          ) {
            return null;
          }
          // Mark as external - will be looked up at runtime
          return { path: p, external: true };
        });
      },
    };
  }
}

/**
 * Load esbuild from node_modules, preferring vault-local installation
 */
export function loadEsbuild(context: ResolutionContext): typeof esbuild | null {
  for (const modulesPath of context.nodeModulesPaths) {
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
  } catch {
    console.error(
      "[remotion] esbuild not found. Install esbuild in your vault (npm i esbuild).",
    );
    return null;
  }
}

/**
 * Bundle TypeScript source code with dependencies
 *
 * Uses esbuild with a markdown loader to handle .md imports.
 * Extracts dependencies from the bundled code.
 */
export async function bundleTypeScriptSource(
  sourceText: string,
  virtualFileName: string,
  esbuildInstance: typeof esbuild | null,
  context: ResolutionContext,
  activeMarkdownPath?: string,
  activeMarkdownText?: string,
): Promise<BundleResult> {
  if (!esbuildInstance) {
    return {
      code: "/* esbuild not found */",
      error: new Error("esbuild not available"),
      bundledModules: new Set<string>(),
    };
  }

  try {
    // Create markdown reader
    const readMarkdownText = (markdownPath: string): string | undefined => {
      if (activeMarkdownPath && markdownPath === activeMarkdownPath) {
        return activeMarkdownText;
      }
      try {
        return fs.readFileSync(markdownPath, "utf-8");
      } catch {
        return undefined;
      }
    };

    // Write source code to a temp file so esbuild can resolve relative imports
    const tempSourcePath = path.join(
      context.resolutionDirectory,
      ".remotion-temp-" + Math.random().toString(36).slice(2) + ".tsx",
    );
    fs.writeFileSync(tempSourcePath, sourceText);

    try {
      // Bundle with markdown loader
      const result = await esbuildInstance.build({
        entryPoints: [tempSourcePath],
        bundle: true,
        format: "iife",
        jsx: "automatic",
        write: false,
        logLevel: "error",
        metafile: true,
        plugins: [
          PluginFactories.createMarkdownLoaderPlugin(readMarkdownText),
          PluginFactories.createExternalizePackagesPlugin(),
        ],
      });

      const bundledModules = new Set<string>();
      if (result.metafile) {
        for (const outputInfo of Object.values(result.metafile.outputs ?? {})) {
          for (const importInfo of outputInfo.imports ?? []) {
            if (importInfo.external && !importInfo.path.startsWith(".")) {
              bundledModules.add(importInfo.path);
            }
          }
        }

        for (const inputInfo of Object.values(result.metafile.inputs ?? {})) {
          for (const importInfo of inputInfo.imports ?? []) {
            if (!importInfo.path.startsWith(".")) {
              bundledModules.add(importInfo.path);
            }
          }
        }
      }

      // When jsx: "automatic" is used, esbuild automatically injects react/jsx-runtime
      // but it's not tracked in metafile when react is external.
      // We need to add it manually if react is in the modules.
      if (bundledModules.has("react")) {
        bundledModules.add("react/jsx-runtime");
      }

      if (result.outputFiles.length > 0) {
        const bundledCode = new TextDecoder().decode(result.outputFiles[0].contents);
        return { code: `window.RemotionBundle = ${bundledCode}`, bundledModules };
      }
      return { code: "", bundledModules };
    } finally {
      // Clean up temp file
      try {
        fs.unlinkSync(tempSourcePath);
      } catch {
        // ignore
      }
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("[bundler] esbuild error:", error);
    return { code: "", error, bundledModules: new Set<string>() };
  }
}

/**
 * Helper to find package entry point
 */
function findPackageEntryPoint(pkgDir: string): string | null {
  const pkgJsonPath = path.join(pkgDir, "package.json");
  if (!fs.existsSync(pkgJsonPath)) {
    const indexPath = path.join(pkgDir, "index.js");
    return fs.existsSync(indexPath) ? indexPath : null;
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
    const entryPoint =
      pkg.main ||
      (pkg.exports && typeof pkg.exports === "string" ? pkg.exports : null) ||
      (pkg.browser && typeof pkg.browser === "string" ? pkg.browser : null);

    if (entryPoint) {
      const resolvedPath = path.join(pkgDir, entryPoint);
      if (fs.existsSync(resolvedPath)) {
        return resolvedPath;
      }
    }
  } catch {
    // Ignore parse errors
  }

  const indexPath = path.join(pkgDir, "index.js");
  return fs.existsSync(indexPath) ? indexPath : null;
}

/**
 * Bundle dependencies with inline embedding for runtime injection
 *
 * Creates a global object containing all dependencies accessible by module ID.
 * Used by iframe's require() mock to satisfy dependency imports.
 */
export async function bundleDependenciesBundle(
  moduleIds: string[],
  esbuildInstance: typeof esbuild | null,
  context: ResolutionContext,
): Promise<BundleResult> {
  if (!esbuildInstance) {
    return {
      code: "/* esbuild not found */",
      error: new Error("esbuild not available"),
      bundledModules: new Set<string>(),
    };
  }

  try {
    const readMarkdownText = (markdownPath: string): string | undefined => {
      try {
        return fs.readFileSync(markdownPath, "utf-8");
      } catch {
        return undefined;
      }
    };

    // Create virtual entry that imports all dependencies
    // For bundling dependencies, we want to bundle them locally, not externalize
    const entryCode = moduleIds
      .map((id, idx) => `import * as m${idx} from '${id}';`)
      .join("\n") +
      "\n" +
      moduleIds.map((id, idx) => `export { m${idx} };`).join("\n");

    const result = await esbuildInstance.build({
      stdin: {
        contents: entryCode,
        loader: "js",
        resolveDir: context.nodeModulesPaths[0] || process.cwd(),
      },
      bundle: true,
      platform: "browser",
      format: "iife",
      globalName: "__REMOTION_DEPS_BUNDLE__",
      write: false,
      minify: false,
      logLevel: "error",
      plugins: [
        PluginFactories.createMarkdownLoaderPlugin(readMarkdownText),
        PluginFactories.createMultiPathResolvePlugin(context.nodeModulesPaths),
        // Note: Do NOT use createExternalizePackagesPlugin here!
        // We want to bundle the dependencies locally, not externalize them.
      ],
    });

    if (result.outputFiles.length > 0) {
      const code = new TextDecoder().decode(result.outputFiles[0].contents);
      return { code };
    }
    return { code: "" };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("[bundler] Failed to bundle dependencies:", error);
    return { code: "", error, bundledModules: new Set<string>() };
  }
}
