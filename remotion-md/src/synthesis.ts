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
 * Synthesize a virtual TSX module by concatenating module blocks and wrapping JSX entry blocks.
 *
 * @param notePath Original markdown file path
 * @param blocks Classified blocks
 * @returns Synthesized module output with scene exports metadata
 */
export function synthesizeVirtualModule(
    notePath: string,
    blocks: ClassifiedBlock[]
): SynthesizedModule {
    const moduleParts: string[] = [];
    const sceneParts: string[] = [];
    const sequenceParts: string[] = [];
    const sceneExports: SceneExport[] = [];

    const makeSentinel = (block: ClassifiedBlock) => {
        const line = block.startLine + 1; // 1-based line number in markdown
        return `// --- block ${block.blockIndex} @ ${notePath}:${line} ---`;
    };

    for (const block of blocks) {
        if (block.type === 'module') {
            moduleParts.push(makeSentinel(block));
            moduleParts.push(block.content);
        }
    }

    // Add preview tracking state at module level
    moduleParts.push('// --- preview tracking ---');
    moduleParts.push('window.__previewScenes = [];');

    for (const block of blocks) {
        if (block.type === 'jsx-entry') {
            sceneExports.push({
                exportName: `__scene_${block.blockIndex}`,
                blockIndex: block.blockIndex,
                startLine: block.startLine + 1,
                contentStartLineOffset: 2,
            });

            sceneParts.push(makeSentinel(block));
            // Emit block content as-is, preview() will track the component
            sceneParts.push(block.content);
        }
    }

    // Export tracked scenes from window
    sequenceParts.push('// --- scene exports ---');
    for (let i = 0; i < sceneExports.length; i++) {
        const exportName = sceneExports[i].exportName;
        sequenceParts.push(`export const ${exportName} = window.__previewScenes[${i}];`);
    }

    sequenceParts.push('// --- sequence export ---');
    sequenceParts.push('type Scene = { id: string; component: () => any };');
    sequenceParts.push('type Sequence = { id: string; scenes: Scene[] };');
    const sequenceId = JSON.stringify(notePath);
    const scenesArray = sceneExports
        .map(({ exportName }) => `{ id: ${JSON.stringify(exportName)}, component: ${exportName} }`)
        .join(', ');
    sequenceParts.push(`const __sequence: Sequence = { id: ${sequenceId}, scenes: [${scenesArray}] };`);
    sequenceParts.push('export default __sequence;');

    const code = [
        ...moduleParts,
        ...sceneParts,
        ...sequenceParts,
    ].join('\n\n');

    return { code, sceneExports };
}
