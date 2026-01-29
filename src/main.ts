import { Plugin, WorkspaceLeaf, MarkdownView } from 'obsidian';
import { PreviewView, PREVIEW_VIEW_TYPE } from './previewView';
import { PluginSettings, DEFAULT_SETTINGS, RemotionSettingTab } from './settings';
import { extractCodeBlocks } from './extraction';

export default class RemotionPlugin extends Plugin {
    public settings!: PluginSettings;

    async onload() {
        await this.loadSettings();

        // Register the Remotion preview view
        this.registerView(PREVIEW_VIEW_TYPE, (leaf: WorkspaceLeaf) => new PreviewView(leaf));

        this.addRibbonIcon('video', 'Toggle Remotion Preview', async () => {
            await this.toggleView();
        });

        // Add settings tab
        this.addSettingTab(new RemotionSettingTab(this.app, this));

        // Listen for active file changes to auto-manage the preview pane
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                this.onActiveLeafChange();
            })
        );

        // Initial check
        this.onActiveLeafChange();

        console.log('Remotion plugin loaded');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private async onActiveLeafChange() {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        
        if (activeView) {
            // Active file is a markdown note, ensure preview is open
            await this.activateView();
            const previewView = this.getPreviewView();
            if (previewView) {
                const blocks = extractCodeBlocks(activeView.editor.getValue());
                previewView.updateExtractedBlocks(blocks);
            }
        } else {
            // No markdown file active, but keep preview open if user wants it
            // (They can close it manually or toggle with ribbon icon)
        }
    }

    private async toggleView() {
        const existing = this.app.workspace.getLeavesOfType(PREVIEW_VIEW_TYPE)[0];
        
        if (existing) {
            this.app.workspace.detachLeavesOfType(PREVIEW_VIEW_TYPE);
        } else {
            await this.activateView();
        }
    }

    private async activateView() {
        const existing = this.app.workspace.getLeavesOfType(PREVIEW_VIEW_TYPE)[0];
        
        if (existing) {
            this.app.workspace.revealLeaf(existing);
            return;
        }

        // Open in right sidebar (similar to backlinks, outline, etc.)
        const leaf = this.app.workspace.getRightLeaf(false);
        if (!leaf) return;

        await leaf.setViewState({
            type: PREVIEW_VIEW_TYPE,
            active: false,
        });
        this.app.workspace.revealLeaf(leaf);
    }

    private getPreviewView(): PreviewView | null {
        const leaf = this.app.workspace.getLeavesOfType(PREVIEW_VIEW_TYPE)[0];
        return leaf?.view instanceof PreviewView ? (leaf.view as PreviewView) : null;
    }

    async onunload() {
        this.app.workspace.detachLeavesOfType(PREVIEW_VIEW_TYPE);
    }
}
