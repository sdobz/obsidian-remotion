import { Plugin, WorkspaceLeaf, MarkdownView, FileSystemAdapter } from 'obsidian';
import { PreviewView, PREVIEW_VIEW_TYPE } from './previewView';
import { PluginSettings, DEFAULT_SETTINGS, RemotionSettingTab } from './settings';
import { extractCodeBlocks, classifyBlocks, synthesizeVirtualModule, compileVirtualModule } from 'remotion-md';
import { bundleVirtualModule } from './bundler';
import path from 'path';
import fs from 'fs';

export default class RemotionPlugin extends Plugin {
    public settings!: PluginSettings;
    private updateTimeoutId: number | null = null;

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

        // Debounced updates on editor change
        this.registerEvent(
            this.app.workspace.on('editor-change', () => {
                this.schedulePreviewUpdate();
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
            this.schedulePreviewUpdate();
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

    private schedulePreviewUpdate() {
        if (this.updateTimeoutId !== null) {
            window.clearTimeout(this.updateTimeoutId);
        }

        this.updateTimeoutId = window.setTimeout(() => {
            this.updateTimeoutId = null;
            void this.updatePreview();
        }, 300);
    }

    private async updatePreview() {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        const previewView = this.getPreviewView();
        if (!activeView || !previewView || !activeView.file) return;

        const blocks = extractCodeBlocks(activeView.editor.getValue());
        const classified = classifyBlocks(blocks);
        const notePath = activeView.file.path;
        const virtualFileName = `/virtual/${notePath}.tsx`;
        const synthesized = synthesizeVirtualModule(notePath, classified);
        const compiled = compileVirtualModule(virtualFileName, synthesized.code);

        const vaultRoot = this.getVaultRootPath();
        if (!vaultRoot) {
            previewView.updateBundleOutput('/* vault root unavailable */');
            return;
        }

        const absoluteNotePath = path.join(vaultRoot, notePath);
        const nodeModulesPaths = this.findNodeModulesPaths(path.dirname(absoluteNotePath), vaultRoot);
        const bundled = await bundleVirtualModule(compiled.code, virtualFileName, nodeModulesPaths);

        previewView.updateBundleOutput(bundled.code || '/* no output */');
    }

    private getPreviewView(): PreviewView | null {
        const leaf = this.app.workspace.getLeavesOfType(PREVIEW_VIEW_TYPE)[0];
        return leaf?.view instanceof PreviewView ? (leaf.view as PreviewView) : null;
    }

    private getVaultRootPath(): string | null {
        const adapter = this.app.vault.adapter;
        if (adapter instanceof FileSystemAdapter) {
            return adapter.getBasePath();
        }
        return null;
    }

    private findNodeModulesPaths(startDir: string, rootDir: string): string[] {
        const paths: string[] = [];
        let current = startDir;

        while (current.startsWith(rootDir)) {
            const candidate = path.join(current, 'node_modules');
            if (fs.existsSync(candidate)) {
                paths.push(candidate);
                break;
            }

            const parent = path.dirname(current);
            if (parent === current) break;
            current = parent;
        }

        if (paths.length === 0) {
            const fallback = path.join(rootDir, 'node_modules');
            if (fs.existsSync(fallback)) {
                paths.push(fallback);
            }
        }

        return paths;
    }

    async onunload() {
        this.app.workspace.detachLeavesOfType(PREVIEW_VIEW_TYPE);
    }
}
