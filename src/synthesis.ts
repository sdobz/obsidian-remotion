import type { ClassifiedBlock } from './extraction';

export interface SceneExport {
    exportName: string;
    blockIndex: number;
    startLine: number;
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

    for (const block of blocks) {
        if (block.type === 'jsx-entry') {
            const exportName = `__scene_${block.blockIndex}`;
            sceneExports.push({
                exportName,
                blockIndex: block.blockIndex,
                startLine: block.startLine + 1,
            });

            sceneParts.push(makeSentinel(block));
            sceneParts.push(
                `export const ${exportName} = () => (\n${block.content}\n);`
            );
        }
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
