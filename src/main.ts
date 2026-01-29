import { Plugin, WorkspaceLeaf } from 'obsidian';
import { PreviewView, PREVIEW_VIEW_TYPE } from './previewView';
import { PluginSettings, DEFAULT_SETTINGS, RemotionSettingTab } from './settings';

export default class RemotionPlugin extends Plugin {
    public settings!: PluginSettings;

    async onload() {
        await this.loadSettings();

        // Register the Remotion preview view
        this.registerView(PREVIEW_VIEW_TYPE, (leaf: WorkspaceLeaf) => new PreviewView(leaf));

        this.addRibbonIcon('video', 'Open Remotion Preview', async () => {
            await this.activateView();
        });

        // Add settings tab
        this.addSettingTab(new RemotionSettingTab(this.app, this));

        console.log('Remotion plugin loaded');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async activateView() {
        const existing = this.app.workspace.getLeavesOfType(PREVIEW_VIEW_TYPE)[0];
        
        if (existing) {
            this.app.workspace.revealLeaf(existing);
            return;
        }

        const leaf = this.app.workspace.getLeaf('split', 'vertical');
        await leaf.setViewState({
            type: PREVIEW_VIEW_TYPE,
            active: false,
        });
        this.app.workspace.revealLeaf(leaf);
    }

    async onunload() {
        this.app.workspace.detachLeavesOfType(PREVIEW_VIEW_TYPE);
    }
}
