import type { EditorPosition } from 'obsidian';
import type { CodeBlock } from 'remotion-md';

/**
 * Maps editor cursor position to the corresponding JSX entry block
 */
export function cursorToBlockIndex(cursorPos: EditorPosition, blocks: CodeBlock[]): number | null {
    const line = cursorPos.line;
    
    // Find the block containing the cursor
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (line >= block.startLine && line <= block.endLine) {
            return i;
        }
    }
    
    return null;
}

/**
 * Generates a scene ID from a block index (matches synthesized module naming)
 */
export function blockIndexToSceneId(blockIndex: number): string {
    return `__scene_${blockIndex}`;
}

/**
 * Converts block metadata back to editor cursor position for scrolling
 */
export function blockToCursorPosition(block: CodeBlock): EditorPosition {
    return { line: block.startLine, ch: 0 };
}
