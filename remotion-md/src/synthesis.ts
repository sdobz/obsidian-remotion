import type { ClassifiedBlock } from './extraction';

export interface SceneExport {
    exportName: string;
    blockIndex: number;
    startLine: number;
    contentStartLineOffset: number;
}

export interface SynthesizedModule {
    code: string;
    sceneExports: SceneExport[];
}

/**
 * Synthesize a virtual TSX module by concatenating all code blocks.
 * Initializes tracking for preview() calls.
 *
 * @param notePath Original markdown file path
 * @param blocks Classified blocks
 * @returns Synthesized module output
 */
export function synthesizeVirtualModule(
    notePath: string,
    blocks: ClassifiedBlock[]
): SynthesizedModule {
    const moduleParts: string[] = [];

    // Initialize global tracking for preview() function calls and options
    moduleParts.push('globalThis.__previewComponents = [];');
    moduleParts.push('globalThis.__previewOptions = [];');

    const makeSentinel = (block: ClassifiedBlock) => {
        const line = block.startLine + 1; // 1-based line number in markdown
        return `// --- block ${block.blockIndex} @ ${notePath}:${line} ---`;
    };

    // Emit all blocks (both module and jsx-entry) as-is
    for (const block of blocks) {
        moduleParts.push(makeSentinel(block));
        moduleParts.push(block.content);
    }

    const code = moduleParts.join('\n\n');
    const sceneExports: SceneExport[] = [];

    return { code, sceneExports };
}
