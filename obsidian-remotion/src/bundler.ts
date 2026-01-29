import * as path from 'path';
import type esbuild from 'esbuild';

export interface BundleResult {
    code: string;
}

function loadEsbuild(nodeModulesPaths: string[]) {
    // Prefer vault-local esbuild if present
    for (const modulesPath of nodeModulesPaths) {
        const candidate = path.join(modulesPath, 'esbuild');
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            return require(candidate);
        } catch {
            // continue
        }
    }

    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require('esbuild');
    } catch (err) {
        throw new Error('esbuild not found. Install esbuild in your vault (npm i esbuild).');
    }
}

export async function bundleVirtualModule(
    entryCode: string,
    entryName: string,
    nodeModulesPaths: string[]
): Promise<BundleResult> {
    const esbuild = loadEsbuild(nodeModulesPaths);

    // Create a virtual module resolver for esbuild
    const virtualModulePlugin: esbuild.Plugin = {
        name: 'virtual-entry',
        setup(build) {
            build.onResolve({ filter: /^virtual-entry$/ }, () => {
                return { path: entryName, namespace: 'virtual' };
            });

            build.onResolve({ filter: /.*/ }, (args) => {
                if (args.path === entryName || args.path.startsWith('/virtual/')) {
                    return { path: args.path, namespace: 'virtual' };
                }
                return null;
            });

            build.onLoad({ filter: /.*/, namespace: 'virtual' }, (args) => {
                if (args.path === entryName || args.path.startsWith('/virtual/')) {
                    return {
                        contents: entryCode,
                        loader: 'ts',
                    };
                }
                return null;
            });
        },
    };

    try {
        const result = await esbuild.build({
            stdin: {
                contents: `
const sequence = require("${entryName}").default;
module.exports = sequence;
`,
                resolveDir: process.cwd(),
            },
            bundle: true,
            format: 'iife',
            write: false,
            logLevel: 'error',
            external: [
                'fs',
                'path',
                'obsidian',
                'esbuild',
                'react',
                'react-dom',
                'react-dom/client',
                'remotion',
                '@remotion/player',
            ],
            plugins: [virtualModulePlugin],
            nodePaths: nodeModulesPaths.length > 0 ? nodeModulesPaths : undefined,
        });

        if (result.outputFiles.length > 0) {
            let rawCode = new TextDecoder().decode(result.outputFiles[0].contents);
            
            // Fix: esbuild IIFE doesn't return the module result, add return statement
            // Replace the last require_stdin() call with return require_stdin()
            rawCode = rawCode.replace(/require_stdin\(\);(\s*}\)\(\);)/, 'return require_stdin();$1');
            
            // The IIFE already returns the bundle object, just assign it to window
            const code = `window.RemotionBundle = ${rawCode}`;
            return { code };
        }

        return { code: '' };
    } catch (err) {
        console.error('[bundler] esbuild error:', err);
        throw err;
    }
}