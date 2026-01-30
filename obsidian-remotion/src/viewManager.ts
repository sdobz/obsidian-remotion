import { App, WorkspaceLeaf } from 'obsidian';
import { PreviewView, PREVIEW_VIEW_TYPE } from './previewView';

export class ViewManager {
    constructor(private app: App) {}

    async toggle(): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(PREVIEW_VIEW_TYPE)[0];
        
        if (existing) {
            this.app.workspace.detachLeavesOfType(PREVIEW_VIEW_TYPE);
        } else {
            await this.activate();
        }
    }

    async activate(): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(PREVIEW_VIEW_TYPE)[0];
        
        if (existing) {
            this.app.workspace.revealLeaf(existing);
            return;
        }

        // Open in right sidebar
        const leaf = this.app.workspace.getRightLeaf(false);
        if (!leaf) return;

        await leaf.setViewState({
            type: PREVIEW_VIEW_TYPE,
            active: false,
        });
        this.app.workspace.revealLeaf(leaf);
    }

    getPreviewView(): PreviewView | null {
        const leaf = this.app.workspace.getLeavesOfType(PREVIEW_VIEW_TYPE)[0];
        return leaf?.view instanceof PreviewView ? (leaf.view as PreviewView) : null;
    }

    detach(): void {
        this.app.workspace.detachLeavesOfType(PREVIEW_VIEW_TYPE);
    }
}
