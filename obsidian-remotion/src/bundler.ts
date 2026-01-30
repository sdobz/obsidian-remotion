import type esbuild from "esbuild";

export interface BundleResult {
  code: string;
  error?: Error;
}

export async function bundleVirtualModule(
  entryCode: string,
  entryName: string,
  esbuildInstance: typeof esbuild,
  runtimeModules?: Set<string>,
): Promise<BundleResult> {
  // Plugin to mock Node builtins that get bundled from remotion-md
  const nodeBuiltinsMockPlugin: esbuild.Plugin = {
    name: "node-builtins-mock",
    setup(build) {
      const builtins = [
        "fs",
        "path",
        "os",
        "crypto",
        "util",
        "stream",
        "events",
      ];

      for (const builtin of builtins) {
        build.onResolve({ filter: new RegExp(`^${builtin}$`) }, (args) => {
          // Only mock if it's being bundled (not already external)
          return { path: builtin, namespace: "node-builtin-mock" };
        });

        build.onLoad(
          { filter: /.*/, namespace: "node-builtin-mock" },
          (args) => {
            return {
              contents: `module.exports = {};`,
              loader: "js",
            };
          },
        );
      }
    },
  };

  // Create a virtual module resolver for esbuild
  const virtualModulePlugin: esbuild.Plugin = {
    name: "virtual-entry",
    setup(build) {
      build.onResolve({ filter: /^virtual-entry$/ }, () => {
        return { path: entryName, namespace: "virtual" };
      });

      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.path === entryName || args.path.startsWith("/virtual/")) {
          return { path: args.path, namespace: "virtual" };
        }
        return null;
      });

      build.onLoad({ filter: /.*/, namespace: "virtual" }, (args) => {
        if (args.path === entryName || args.path.startsWith("/virtual/")) {
          return {
            contents: entryCode,
            loader: "tsx",
          };
        }
        return null;
      });
    },
  };

  // Only externalize core frameworks that will be provided at runtime
  // Node builtins are mocked by nodeBuiltinsMockPlugin
  const externalModules = [
    "obsidian",
    "electron",
    "react",
    "react/jsx-runtime",
    "react-dom",
    "react-dom/client",
    "remotion",
    "@remotion/player",
  ];

  if (runtimeModules) {
    for (const mod of runtimeModules) {
      if (!externalModules.includes(mod)) {
        externalModules.push(mod);
      }
    }
  }

  try {
    const result = await esbuildInstance.build({
      stdin: {
        contents: `
const sequence = require("${entryName}").default;
module.exports = sequence;
`,
      },
      bundle: true,
      format: "iife",
      write: false,
      logLevel: "error",
      external: externalModules,
      plugins: [nodeBuiltinsMockPlugin, virtualModulePlugin],
    });

    if (result.outputFiles.length > 0) {
      let rawCode = new TextDecoder().decode(result.outputFiles[0].contents);

      // Fix: esbuild IIFE doesn't return the module result, add return statement
      // Replace the last require_stdin() call with return require_stdin()
      rawCode = rawCode.replace(
        /require_stdin\(\);(\s*}\)\(\);)/,
        "return require_stdin();$1",
      );

      // The IIFE already returns the bundle object, just assign it to window
      const code = `window.RemotionBundle = ${rawCode}`;
      return { code };
    }

    return { code: "" };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("[bundler] esbuild error:", error);
    return { code: "", error };
  }
}
