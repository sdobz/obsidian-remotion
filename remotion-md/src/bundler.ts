/**
 * ESBuild Bundling Module
 *
 * Pure bundling functionality with no Obsidian dependencies.
 * Handles TypeScript/JavaScript bundling with markdown support.
 */

import type esbuild from "esbuild";
import * as fs from "fs";
import * as path from "path";
import { synthesizeMarkdownModule } from "./synthesis";
import { isVirtualMarkdownFileName, virtualMarkdownToFileName } from "./resolution";

export interface BundleResult {
    code: string;
    error?: Error;
    bundledModules?: Set<string>;
}

export interface BundleContext {
    /** Directories to search for node_modules */
    nodeModulesPaths: string[];
    /** Directory for temporary files */
    resolutionDirectory: string;
}

/**
 * ESBuild Plugin Factories
 *
 * Pure functions that create esbuild plugins for different scenarios.
 * These can be tested independently and composed as needed.
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

                // Also handle .md.tsx virtual imports
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
                        const synthesized = synthesizeMarkdownModule(markdownPath, markdownText);
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
 * Load esbuild from node_modules
 *
 * Tries to load esbuild from multiple node_modules paths,
 * falling back to the global installation.
 *
 * @param contextOrPaths BundleContext or array of node_modules paths
 * @returns esbuild instance or null if not found
 */
export function loadEsbuild(
    contextOrPaths: BundleContext | string[] | { nodeModulesPaths: string[] },
): typeof esbuild | null {
    // Extract nodeModulesPaths from whatever format we receive
    const nodeModulesPaths = Array.isArray(contextOrPaths)
        ? contextOrPaths
        : contextOrPaths.nodeModulesPaths;

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
    } catch {
        console.error(
            "[remotion-md] esbuild not found. Install esbuild (npm i esbuild).",
        );
        return null;
    }
}

/**
 * Bundle TypeScript source code with dependencies
 *
 * Uses esbuild with a markdown loader to handle .md imports.
 * Extracts dependencies from the bundled code via metafile.
 *
 * @param sourceText TypeScript source code to bundle
 * @param virtualFileName Virtual filename for the source (e.g., Note.md.tsx)
 * @param esbuildInstance esbuild instance to use
 * @param context Bundle context with paths
 * @param activeMarkdownPath Optional path to active markdown file
 * @param activeMarkdownText Optional content of active markdown file
 * @returns Bundle result with code and discovered modules
 */
export async function bundleTypeScriptSource(
    sourceText: string,
    virtualFileName: string,
    esbuildInstance: typeof esbuild | null,
    context: BundleContext,
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
                absWorkingDir: context.resolutionDirectory,
                nodePaths: context.nodeModulesPaths,
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
                // Extract external imports from outputs
                for (const outputInfo of Object.values(result.metafile.outputs ?? {})) {
                    for (const importInfo of outputInfo.imports ?? []) {
                        if (importInfo.external && !importInfo.path.startsWith(".")) {
                            bundledModules.add(importInfo.path);
                        }
                    }
                }

                // Extract imports from inputs (source files)
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

            // Filter out markdown imports (these are source files, not runtime deps)
            for (const mod of Array.from(bundledModules)) {
                if (mod.endsWith(".md") || mod.endsWith(".mdx")) {
                    bundledModules.delete(mod);
                }
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
 * Bundle dependencies with inline embedding for runtime injection
 *
 * Creates a global object containing all dependencies accessible by module ID.
 * Used by iframe's require() mock to satisfy dependency imports.
 *
 * @param moduleIds List of module IDs to bundle (e.g., ["react", "@remotion/core"])
 * @param esbuildInstance esbuild instance to use
 * @param context Bundle context with paths
 * @returns Bundle result with bundled dependencies code
 */
export async function bundleDependenciesBundle(
    moduleIds: string[],
    esbuildInstance: typeof esbuild | null,
    context: BundleContext,
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
                resolveDir: context.resolutionDirectory,
            },
            absWorkingDir: context.resolutionDirectory,
            nodePaths: context.nodeModulesPaths,
            bundle: true,
            platform: "browser",
            format: "iife",
            globalName: "__REMOTION_DEPS_BUNDLE__",
            write: false,
            minify: false,
            logLevel: "error",
            plugins: [
                PluginFactories.createMarkdownLoaderPlugin(readMarkdownText),
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
