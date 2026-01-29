import { rollup } from 'rollup';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export interface BundleResult {
    code: string;
}

export async function bundleVirtualModule(
    entryCode: string,
    entryName: string,
    nodeModulesPaths: string[]
): Promise<BundleResult> {
    const virtualEntryId = '\0virtual-entry';

    const virtualPlugin = {
        name: 'virtual-entry',
        resolveId(id: string) {
            if (id === entryName) return virtualEntryId;
            return null;
        },
        load(id: string) {
            if (id === virtualEntryId) return entryCode;
            return null;
        },
    };

    const bundle = await rollup({
        input: entryName,
        plugins: [
            virtualPlugin,
            resolve({
                browser: true,
                preferBuiltins: false,
                extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
                modulePaths: nodeModulesPaths,
            }),
            commonjs(),
        ],
        onwarn: (warning, warn) => {
            if (warning.code === 'CIRCULAR_DEPENDENCY') return;
            warn(warning);
        },
    });

    const { output } = await bundle.generate({
        format: 'iife',
        name: 'RemotionBundle',
        inlineDynamicImports: true,
        sourcemap: false,
    });

    const chunk = output.find((o) => o.type === 'chunk');
    const code = chunk?.code ?? '';

    await bundle.close();

    return { code };
}