/**
 * Bundler module - delegates to remotion-md
 *
 * This module now re-exports bundling functionality from remotion-md.
 * All bundling logic has been moved to remotion-md to make it pure and testable.
 */

import type esbuild from "esbuild";
import * as RemotionMd from "remotion-md";

// Re-export types and namespaces
export type BundleResult = RemotionMd.BundleResult;
export type BundleContext = RemotionMd.BundleContext;
export const PluginFactories = RemotionMd.PluginFactories;

<<<<<<< HEAD
// Re-export functions
export const loadEsbuild = RemotionMd.loadEsbuild;
export const bundleTypeScriptSource = RemotionMd.bundleTypeScriptSource;
export const bundleDependenciesBundle = RemotionMd.bundleDependenciesBundle;
=======
export function loadEsbuild(vaultRoot: string): typeof esbuild | null {
  const nodeModulesPaths = findNodeModulesPaths(vaultRoot);
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
      "[remotion] esbuild not found. Install esbuild in your vault (npm i esbuild).",
    );
    return null;
  }
}

async function bundleVirtualModule(
  entryCode: string,
  entryName: string,
  esbuildInstance: typeof esbuild,
  nodeModulesPaths: string[],
  activeMarkdownPath?: string,
  activeMarkdownText?: string,
): Promise<BundleResult> {
  const builtins = ["fs", "path", "os", "crypto", "util", "stream", "events"];
  const resolutionDirectory = getResolutionDirectory(
    nodeModulesPaths,
    path.dirname(entryName),
  );

  const compilerOptions: ts.CompilerOptions = {
    jsx: ts.JsxEmit.React,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
  };

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

  const hasMarkdownText = (markdownPath: string): boolean => {
    if (activeMarkdownPath && markdownPath === activeMarkdownPath) {
      return true;
    }
    return fs.existsSync(markdownPath);
  };

  const moduleResolutionHost: ts.ModuleResolutionHost = {
    fileExists: (fileName) => {
      if (isVirtualMarkdownFileName(fileName)) {
        const markdownPath = virtualMarkdownToFileName(fileName);
        return markdownPath ? hasMarkdownText(markdownPath) : false;
      }
      return fs.existsSync(fileName);
    },
    readFile: (fileName) => {
      if (isVirtualMarkdownFileName(fileName)) {
        const markdownPath = virtualMarkdownToFileName(fileName);
        if (!markdownPath) return undefined;
        const markdownText = readMarkdownText(markdownPath);
        if (markdownText === undefined) return undefined;
        return synthesizeMarkdownModule(markdownPath, markdownText).code;
      }
      return fs.readFileSync(fileName, "utf-8");
    },
    getCurrentDirectory: () => resolutionDirectory,
    getDirectories: (dirPath) => {
      try {
        return fs
          .readdirSync(dirPath, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);
      } catch {
        return [];
      }
    },
  };

  const moduleResolver = createModuleResolver(
    resolutionDirectory,
    compilerOptions,
    moduleResolutionHost,
  );

  const virtualModulePlugin: esbuild.Plugin = {
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

  const tsResolvePlugin: esbuild.Plugin = {
    name: "ts-resolve",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.path === "virtual-entry" || args.path === entryName) {
          return null;
        }
        const isRelativeOrAbsolute =
          args.path.startsWith(".") || args.path.startsWith("/");
        if (!isRelativeOrAbsolute) return null;
        const containingFile = args.importer || entryName;
        const resolved = moduleResolver([args.path], containingFile)[0];
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

  const externalizePackagesPlugin: esbuild.Plugin = {
    name: "externalize-packages",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const p = args.path;
        if (
          p.startsWith(".") ||
          p.startsWith("/") ||
          p === entryName ||
          p === "virtual-entry" ||
          builtins.includes(p)
        ) {
          return null;
        }
        return { path: p, external: true };
      });
    },
  };

  try {
    const result = await esbuildInstance.build({
      stdin: {
        contents:
          'const sequence = require("virtual-entry").default;\nmodule.exports = sequence;',
        resolveDir: path.dirname(entryName),
      },
      bundle: true,
      format: "iife",
      write: false,
      logLevel: "error",
      plugins: [
        tsResolvePlugin,
        externalizePackagesPlugin,
        // nodeBuiltinsMockPlugin,
        virtualModulePlugin,
      ],
    });

    if (result.outputFiles.length > 0) {
      let rawCode = new TextDecoder().decode(result.outputFiles[0].contents);
      rawCode = rawCode.replace(
        /require_stdin\(\);(\s*}\)\(\);)/,
        "return require_stdin();$1",
      );
      return { code: `window.RemotionBundle = ${rawCode}` };
    }
    return { code: "" };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("[bundler] esbuild error:", error);
    return { code: "", error };
  }
}

export async function bundleTypeScriptSource(
  sourceText: string,
  virtualFileName: string,
  esbuildInstance: typeof esbuild | null,
  nodeModulesPaths: string[],
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
    return await bundleVirtualModule(
      sourceText,
      virtualFileName,
      esbuildInstance,
      nodeModulesPaths,
      activeMarkdownPath,
      activeMarkdownText,
    );
  } catch (err) {
    console.error("[remotion] Bundle failed:", err);
    return {
      code: "/* Bundle failed */",
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

function findPackageEntryPoint(pkgDir: string): string | null {
  const pkgJsonPath = path.join(pkgDir, "package.json");
  if (!fs.existsSync(pkgJsonPath)) {
    // No package.json, try index.js
    const indexPath = path.join(pkgDir, "index.js");
    return fs.existsSync(indexPath) ? indexPath : null;
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
    // Try to find an entry point
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

  // Default to index.js
  const indexPath = path.join(pkgDir, "index.js");
  return fs.existsSync(indexPath) ? indexPath : null;
}

function createMultiPathResolvePlugin(
  nodeModulesPaths: string[],
): esbuild.Plugin {
  return {
    name: "multi-path-resolve",
    setup(build) {
      // Only try to resolve npm packages (not relative/absolute paths)
      build.onResolve({ filter: /^(@[a-zA-Z0-9-]+\/)?[a-zA-Z0-9-_.]+/ }, (args) => {
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

          // Found the package directory
          const entryPoint = findPackageEntryPoint(pkgDir);
          if (entryPoint) {
            return { path: entryPoint };
          }
        }

        return null;
      });
    },
  };
}

export async function bundleDependenciesBundle(
  moduleIds: string[],
  esbuildInstance: typeof esbuild | null,
  nodeModulesPaths: string[] = [],
): Promise<BundleResult> {
  if (!esbuildInstance) {
    return {
      code: "/* esbuild not found */",
      error: new Error("esbuild not available"),
    };
  }

  try {
    // Create a virtual entry point that re-exports all dependencies
    // Import the entire module namespace since many ESM packages don't have default exports
    const entryCode = moduleIds
      .map((id, idx) => `import * as m${idx} from '${id}';`)
      .join("\n") +
      "\n" +
      moduleIds.map((id, idx) => `export { m${idx} };`).join("\n");

    const result = await esbuildInstance.build({
      stdin: {
        contents: entryCode,
        loader: "js",
        resolveDir: nodeModulesPaths[0] || process.cwd(),
      },
      bundle: true,
      platform: "browser",
      format: "iife",
      globalName: "__REMOTION_DEPS_BUNDLE__",
      write: false,
      minify: false,
      logLevel: "error",
      plugins: [createMultiPathResolvePlugin(nodeModulesPaths)],
    });
    if (result.outputFiles.length > 0) {
      const code = new TextDecoder().decode(result.outputFiles[0].contents);
      return { code };
    }
    return { code: "" };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("[bundler] Failed to bundle dependencies:", error);
    return { code: "", error };
  }
}
>>>>>>> 5cef3bd (Uh code churn)
