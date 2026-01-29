import { MarkdownView } from 'obsidian';

export interface CodeBlock {
    content: string;
    language: string;
    startLine: number;
    endLine: number;
    startOffset: number;
    endOffset: number;
}

/**
 * Extract all fenced code blocks with language ts, tsx, or typescript from markdown content.
 * 
 * @param content Raw markdown content string
 * @returns Array of extracted code blocks with line and offset information
 */
export function extractCodeBlocks(content: string): CodeBlock[] {
    const blocks: CodeBlock[] = [];
    const lines = content.split('\n');
    
    let i = 0;
    let currentOffset = 0;

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        // Look for opening fence (``` or ~~~)
        if ((trimmed.startsWith('```') || trimmed.startsWith('~~~')) && trimmed.length >= 3) {
            const fence = trimmed.startsWith('```') ? '```' : '~~~';
            const fenceChar = fence[0];
            
            // Extract language from the opening fence
            const languageMatch = trimmed.slice(3).match(/^\w+/);
            const language = languageMatch ? languageMatch[0] : '';

            // Only process ts, tsx, typescript blocks
            if (['ts', 'tsx', 'typescript'].includes(language)) {
                const startLine = i;
                const startOffset = currentOffset;
                let blockContent = '';
                
                i++; // Move to line after opening fence
                currentOffset += line.length + 1; // +1 for newline

                // Collect content until closing fence
                while (i < lines.length) {
                    const contentLine = lines[i];
                    const contentTrimmed = contentLine.trim();

                    // Check for closing fence
                    if (contentTrimmed.startsWith(fenceChar) && contentTrimmed.length >= 3) {
                        const endOffset = currentOffset;
                        const endLine = i;

                        blocks.push({
                            content: blockContent.trimEnd(), // Remove trailing whitespace
                            language,
                            startLine,
                            endLine,
                            startOffset,
                            endOffset,
                        });

                        currentOffset += contentLine.length + 1;
                        i++;
                        break;
                    }

                    blockContent += contentLine + '\n';
                    currentOffset += contentLine.length + 1;
                    i++;
                }
            } else {
                // Not a ts/tsx block, skip to next line
                currentOffset += line.length + 1;
                i++;
            }
        } else {
            currentOffset += line.length + 1;
            i++;
        }
    }

    return blocks;
}

/**
 * Extract code blocks from the active markdown view.
 * 
 * @param view The active MarkdownView
 * @returns Array of extracted code blocks, or empty array if view is not markdown
 */
export function extractFromView(view: MarkdownView): CodeBlock[] {
    const content = view.editor.getValue();
    return extractCodeBlocks(content);
}

/**
 * Map a code block to markdown line and column position.
 * Useful for reverse-mapping diagnostics from the virtual TS module back to markdown.
 * 
 * @param block The code block
 * @param lineInBlock Line number within the block content (0-indexed)
 * @returns { line, column } in markdown document
 */
export function blockPositionToMarkdown(
    block: CodeBlock,
    lineInBlock: number
): { line: number; column: number } {
    // +1 for the opening fence line, then add lineInBlock
    return {
        line: block.startLine + 1 + lineInBlock,
        column: 0,
    };
}
