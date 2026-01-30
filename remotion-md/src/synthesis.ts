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

    // Inline preview() helper into synthesized module to avoid exporting it from remotion-md
    moduleParts.push(`type PreviewPlayerOptions = {
    durationInFrames?: number;
    fps?: number;
    compositionWidth?: number;
    compositionHeight?: number;
    controls?: boolean;
    loop?: boolean;
    autoPlay?: boolean;
    [key: string]: any;
};`);
    // Reset preview tracking at module start to prevent accumulation when switching files
    moduleParts.push(`if (typeof globalThis !== 'undefined') {
    (globalThis as any).__previewComponents = [];
    (globalThis as any).__previewOptions = [];
}`);
    
    moduleParts.push(`const PREVIEW_DEFAULTS = {
    durationInFrames: 150,
    fps: 30,
    compositionWidth: 1280,
    compositionHeight: 720,
    controls: true,
    loop: false,
    autoPlay: false,
};`);
    
    moduleParts.push(`function preview(component: React.ComponentType<any>, options?: any) {
    const anyGlobal = globalThis as any;
    const index = anyGlobal.__previewComponents.length;
    anyGlobal.__previewComponents[index] = component;
    anyGlobal.__previewOptions[index] = { ...PREVIEW_DEFAULTS, ...options };
    return component;
}`);

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
