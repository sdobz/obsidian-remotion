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
import { virtualMarkdownToFileName } from "./resolution";

export interface BundleResult {
    code: string;
    error?: Error;
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
 * Takes an array of node_modules directory paths and attempts to load esbuild
 * from the first one that exists, falling back to the global installation.
 *
 * @param nodeModulesPaths Array of absolute paths to node_modules directories
 * @returns esbuild instance or null if not found
 */
export function loadEsbuild(nodeModulesPaths: string[]): typeof esbuild | null {
    const isDebug = process.env.DEBUG_ESBUILD === "1";

    if (isDebug) {
        console.log("[esbuild-loader] Attempting to load esbuild...");
        console.log("[esbuild-loader] nodeModulesPaths:", nodeModulesPaths);
    }

    for (const modulesPath of nodeModulesPaths) {
        const candidate = path.join(modulesPath, "esbuild");

        if (isDebug) {
            console.log("[esbuild-loader] Trying:", candidate);
            // Check if path exists
            const exists = fs.existsSync(modulesPath);
            console.log("[esbuild-loader]   node_modules exists:", exists);
            if (exists) {
                const contents = fs.readdirSync(modulesPath).slice(0, 5);
                console.log("[esbuild-loader]   node_modules contents (first 5):", contents);
            }
        }

        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const loaded = require(candidate);
            if (isDebug) {
                console.log("[esbuild-loader] Successfully loaded esbuild from:", candidate);
            }
            return loaded;
        } catch (err) {
            if (isDebug) {
                console.log("[esbuild-loader]   Failed:", (err as any).code || String(err));
            }
            // continue to next path
        }
    }

    // Try global esbuild as fallback
    if (isDebug) {
        console.log("[esbuild-loader] Trying global esbuild...");
    }

    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const loaded = require("esbuild");
        if (isDebug) {
            console.log("[esbuild-loader] Successfully loaded global esbuild");
        }
        return loaded;
    } catch (err) {
        if (isDebug) {
            console.log("[esbuild-loader] Failed to load global esbuild:", (err as any).code || String(err));
        }
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
            // IIFE format bundles everything together - all dependencies included in the IIFE wrapper
            const result = await esbuildInstance.build({
                entryPoints: [tempSourcePath],
                absWorkingDir: context.resolutionDirectory,
                nodePaths: context.nodeModulesPaths,
                bundle: true,
                format: "iife",
                globalName: "__RemotionBundle__",
                jsx: "automatic",
                write: false,
                logLevel: "error",
                plugins: [
                    PluginFactories.createMarkdownLoaderPlugin(readMarkdownText),
                ],
            });

            if (result.outputFiles.length > 0) {
                const bundledCode = new TextDecoder().decode(result.outputFiles[0].contents);
                // The IIFE already creates a global with the globalName
                // Just expose it as RemotionBundle for iframe to access
                const wrappedCode = `
                  ${bundledCode}
                  window.RemotionBundle = __RemotionBundle__;
                `;
                return { code: wrappedCode };
            }
            return { code: "" };
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
        return { code: "", error };
    }
}


