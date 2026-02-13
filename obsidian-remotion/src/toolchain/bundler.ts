import type esbuild from "esbuild";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  createModuleResolver,
  findNodeModulesPaths,
  getResolutionDirectory,
  isVirtualMarkdownFileName,
  synthesizeMarkdownModule,
  virtualMarkdownToFileName,
} from "remotion-md";

export interface BundleResult {
  code: string;
  error?: Error;
}

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

  const moduleResolutionHost: ts.ModuleResolutionHost = {
    fileExists: (fileName) => {
      if (isVirtualMarkdownFileName(fileName)) {
        const markdownPath = virtualMarkdownToFileName(fileName);
        return markdownPath ? fs.existsSync(markdownPath) : false;
      }
      return fs.existsSync(fileName);
    },
    readFile: (fileName) => {
      if (isVirtualMarkdownFileName(fileName)) {
        const markdownPath = virtualMarkdownToFileName(fileName);
        if (!markdownPath) return undefined;
        const markdownText = fs.readFileSync(markdownPath, "utf-8");
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
          const markdownText = fs.readFileSync(markdownPath, "utf-8");
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
        contents: `const sequence = require("${entryName}").default;\nmodule.exports = sequence;`,
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
    );
  } catch (err) {
    console.error("[remotion] Bundle failed:", err);
    return {
      code: "/* Bundle failed */",
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
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
    const entryCode =
      moduleIds
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
      format: "cjs",
      write: false,
      minify: false,
      logLevel: "error",
      nodePaths: nodeModulesPaths,
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
