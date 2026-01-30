import { MarkdownView } from 'obsidian';
import type { PreviewView } from './previewView';

export class ScrollSync {
    private scrollSyncTimeoutId: number | null = null;
    private currentScrollDOM: HTMLElement | null = null;
    private scrollListener: (() => void) | null = null;
    private isSyncingScroll = false;

    attach(activeView: MarkdownView, callback: () => void): void {
        this.detach();

        const editorEl = (activeView.editor as any).cm;
        const scrollDOM = editorEl?.scrollDOM;
        
        if (scrollDOM) {
            this.currentScrollDOM = scrollDOM;
            this.scrollListener = () => {
                this.scheduleSync(callback);
            };
            scrollDOM.addEventListener('scroll', this.scrollListener);
        }
    }

    detach(): void {
        if (this.currentScrollDOM && this.scrollListener) {
            this.currentScrollDOM.removeEventListener('scroll', this.scrollListener);
        }
        this.currentScrollDOM = null;
        this.scrollListener = null;
    }

    private scheduleSync(callback: () => void): void {
        if (this.scrollSyncTimeoutId !== null) {
            window.clearTimeout(this.scrollSyncTimeoutId);
        }

        this.scrollSyncTimeoutId = window.setTimeout(() => {
            this.scrollSyncTimeoutId = null;
            callback();
        }, 5);
    }

    syncEditorToPreview(activeView: MarkdownView, previewView: PreviewView): void {
        if (this.isSyncingScroll) return;

        const editorEl = (activeView.editor as any).cm;
        const scrollDOM = editorEl?.scrollDOM;
        
        if (scrollDOM) {
            const scrollTop = scrollDOM.scrollTop;
            const viewportHeight = scrollDOM.clientHeight || 600;
            this.isSyncingScroll = true;
            previewView.syncScroll(scrollTop, viewportHeight);
            setTimeout(() => { this.isSyncingScroll = false; }, 50);
        }
    }

    syncPreviewToEditor(activeView: MarkdownView, scrollTop: number): void {
        if (this.isSyncingScroll) return;

        const editorEl = (activeView.editor as any).cm;
        const scrollDOM = editorEl?.scrollDOM;
        
        if (scrollDOM) {
            this.isSyncingScroll = true;
            scrollDOM.scrollTop = scrollTop;
            setTimeout(() => { this.isSyncingScroll = false; }, 50);
        }
    }
}
