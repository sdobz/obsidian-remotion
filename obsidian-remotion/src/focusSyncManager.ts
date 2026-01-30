import { MarkdownView } from 'obsidian';
import { extractCodeBlocks } from 'remotion-md';
import { cursorToBlockIndex, blockIndexToSceneId } from './focusSync';
import type { PreviewView } from './previewView';
import type { ClassifiedBlock } from 'remotion-md';

export class FocusSyncManager {
    private focusSyncTimeoutId: number | null = null;
    private lastCursorBlockIndex: number | null = null;

    scheduleSync(callback: () => void): void {
        if (this.focusSyncTimeoutId !== null) {
            window.clearTimeout(this.focusSyncTimeoutId);
        }

        this.focusSyncTimeoutId = window.setTimeout(() => {
            this.focusSyncTimeoutId = null;
            callback();
        }, 50);
    }

    syncCursorToPreview(activeView: MarkdownView, previewView: PreviewView, blocks: ClassifiedBlock[]): void {
        const cursorPos = activeView.editor.getCursor();
        const codeBlocks = extractCodeBlocks(activeView.editor.getValue());
        const blockIndex = cursorToBlockIndex(cursorPos, codeBlocks);

        // Only send message if block changed
        if (blockIndex !== this.lastCursorBlockIndex) {
            this.lastCursorBlockIndex = blockIndex;
            if (blockIndex !== null) {
                const sceneId = blockIndexToSceneId(blockIndex);
                previewView.focusScene(sceneId);
            }
        }
    }

    syncPreviewToEditor(activeView: MarkdownView, sceneId: string, blocks: ClassifiedBlock[]): void {
        const match = sceneId?.match(/__scene_(\d+)/);
        if (!match) return;

        const blockIndex = parseInt(match[1], 10);
        if (blockIndex >= 0 && blockIndex < blocks.length) {
            const block = blocks[blockIndex];
            activeView.editor.setCursor({ line: block.startLine, ch: 0 });
            activeView.editor.scrollIntoView({
                from: { line: block.startLine, ch: 0 },
                to: { line: block.endLine, ch: 0 }
            });
        }
    }
}
