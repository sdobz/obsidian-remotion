import {
  classifyBlocks,
  extractCodeBlocks,
  type ClassifiedBlock,
} from "./extraction";

export interface SceneExport {
  exportName: string;
  blockIndex: number;
}

export interface SynthesizedModule {
  code: string;
  sceneExports: SceneExport[];
}

/**
 * Synthesize a virtual TSX module by concatenating all code blocks.
 * 
 * @param notePath Original markdown file path
 * @param blocks Classified blocks
 * @returns Synthesized module code
 */
export function synthesizeVirtualModule(
  notePath: string,
  blocks: ClassifiedBlock[],
): SynthesizedModule {
  const moduleParts: string[] = [];

  const makeSentinel = (block: ClassifiedBlock) => {
    const line = block.startLine + 1; // 1-based line number in markdown
    return `// --- block ${block.blockIndex} @ ${notePath}:${line} ---`;
  };

  // Emit all blocks as-is
  for (const block of blocks) {
    moduleParts.push(makeSentinel(block));
    moduleParts.push(block.content);
  }

  const code = moduleParts.join("\n\n");
  const sceneExports: SceneExport[] = [];
  return { code, sceneExports };
}

/**
 * Synthesize a virtual TSX module directly from markdown content.
 */
export function synthesizeMarkdownModule(
  notePath: string,
  markdownText: string,
): SynthesizedModule {
  const blocks = classifyBlocks(extractCodeBlocks(markdownText));
  return synthesizeVirtualModule(notePath, blocks);
}
