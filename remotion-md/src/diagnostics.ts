import ts from 'typescript';
import type { ClassifiedBlock } from './extraction';
import type { SceneExport } from './synthesis';

export type DiagnosticCategory = 'error' | 'warning' | 'suggestion' | 'message';

export interface MarkdownDiagnostic {
    line: number;
    column: number;
    message: string;
    blockIndex: number;
    category: DiagnosticCategory;
    code?: number;
    source?: 'typescript' | 'bundle';
}

interface SentinelInfo {
    lineIndex: number;
    blockIndex: number;
    markdownStartLine: number;
}

const sentinelRegex = /^\/\/ --- block (\d+) @ .+:(\d+) ---$/;

function categoryToString(category: ts.DiagnosticCategory): DiagnosticCategory {
    switch (category) {
        case ts.DiagnosticCategory.Error:
            return 'error';
        case ts.DiagnosticCategory.Warning:
            return 'warning';
        case ts.DiagnosticCategory.Suggestion:
            return 'suggestion';
        default:
            return 'message';
    }
}

function extractSentinels(sourceText: string): SentinelInfo[] {
    const sentinels: SentinelInfo[] = [];
    const lines = sourceText.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const match = line.match(sentinelRegex);
        if (match) {
            const blockIndex = parseInt(match[1], 10);
            const markdownStartLine = parseInt(match[2], 10) - 1; // to 0-based
            sentinels.push({ lineIndex: i, blockIndex, markdownStartLine });
        }
    }

    return sentinels;
}

function findSentinelForLine(sentinels: SentinelInfo[], lineIndex: number): SentinelInfo | null {
    let low = 0;
    let high = sentinels.length - 1;
    let result: SentinelInfo | null = null;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const sentinel = sentinels[mid];
        if (sentinel.lineIndex <= lineIndex) {
            result = sentinel;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    return result;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/**
 * Map TypeScript diagnostics in the synthesized virtual module back to markdown line/column positions.
 */
export function mapDiagnosticsToMarkdown(
    diagnostics: readonly ts.Diagnostic[],
    sourceText: string,
    blocks: ClassifiedBlock[],
    sceneExports: SceneExport[]
): MarkdownDiagnostic[] {
    if (diagnostics.length === 0) return [];

    const sentinels = extractSentinels(sourceText);
    if (sentinels.length === 0) return [];

    const blockMap = new Map<number, ClassifiedBlock>();
    for (const block of blocks) {
        blockMap.set(block.blockIndex, block);
    }

    const sceneExportMap = new Map<number, SceneExport>();
    for (const sceneExport of sceneExports) {
        sceneExportMap.set(sceneExport.blockIndex, sceneExport);
    }

    const results: MarkdownDiagnostic[] = [];

    for (const diagnostic of diagnostics) {
        if (!diagnostic.file || diagnostic.start === undefined) continue;

        const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
        const sentinel = findSentinelForLine(sentinels, position.line);
        if (!sentinel) continue;

        const block = blockMap.get(sentinel.blockIndex);
        if (!block) continue;

        const isJsxEntry = block.type === 'jsx-entry';
        const contentStartLineOffset = isJsxEntry
            ? (sceneExportMap.get(sentinel.blockIndex)?.contentStartLineOffset ?? 2)
            : 0;
        const contentStartLine = sentinel.lineIndex + contentStartLineOffset + 1;
        const blockLineCount = Math.max(0, block.endLine - block.startLine);

        let markdownLine = block.startLine;
        let column = 0;

        if (position.line >= contentStartLine) {
            const lineInBlock = position.line - contentStartLine;
            const clampedLineInBlock = clamp(lineInBlock, 0, Math.max(0, blockLineCount - 1));
            markdownLine = block.startLine + 1 + clampedLineInBlock;
            column = Math.max(0, position.character);
        }

        results.push({
            line: markdownLine,
            column,
            message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
            blockIndex: block.blockIndex,
            category: categoryToString(diagnostic.category),
            code: diagnostic.code,
            source: 'typescript',
        });
    }

    return results;
}

/**
 * Parse a bundle error and map it to a markdown diagnostic
 * Format: "virtual:/virtual/path.md.tsx:21:21: ERROR: message"
 */
export function parseBundleError(error: Error, blocks: ClassifiedBlock[]): MarkdownDiagnostic | null {
    const message = error.message;
    
    // Try to extract line number from error message
    const match = message.match(/virtual:\/virtual\/[^:]+:(\d+):(\d+):\s*ERROR:\s*(.+?)(?:\n|$)/);
    if (!match) return null;

    const virtualLine = parseInt(match[1], 10) - 1; // to 0-based
    const column = parseInt(match[2], 10) - 1;
    const errorMsg = match[3].trim();

    // Find which block this line belongs to
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        // Each block has approximately (block.endLine - block.startLine) lines
        // Plus wrapper lines and sentinels
        // For now, try to match to first jsx-entry block as a fallback
        if (block.type === 'jsx-entry') {
            return {
                line: Math.max(block.startLine + 1, Math.min(block.endLine, block.startLine + (virtualLine % 10))),
                column: Math.max(0, column),
                message: errorMsg,
                blockIndex: i,
                category: 'error',
                source: 'bundle',
            };
        }
    }

    // Fallback: report on line 1 of first block
    if (blocks.length > 0) {
        return {
            line: blocks[0].startLine + 1,
            column: 0,
            message: errorMsg,
            blockIndex: 0,
            category: 'error',
            source: 'bundle',
        };
    }

    return null;
}