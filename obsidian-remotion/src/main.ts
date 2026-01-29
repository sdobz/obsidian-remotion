import { Plugin, WorkspaceLeaf, MarkdownView, FileSystemAdapter } from 'obsidian';
import { PreviewView, PREVIEW_VIEW_TYPE } from './previewView';
import { PluginSettings, DEFAULT_SETTINGS, RemotionSettingTab } from './settings';
import { extractCodeBlocks, classifyBlocks, synthesizeVirtualModule, compileVirtualModule } from 'remotion-md';
import { bundleVirtualModule } from './bundler';
import { cursorToBlockIndex, blockIndexToSceneId } from './focusSync';
import path from 'path';
import fs from 'fs';

export default class RemotionPlugin extends Plugin {
    public settings!: PluginSettings;
    private updateTimeoutId: number | null = null;
    private focusSyncTimeoutId: number | null = null;
    private scrollSyncTimeoutId: number | null = null;
    private lastCursorBlockIndex: number | null = null;
    private lastExtractedBlocks: any[] = [];
    private currentScrollDOM: HTMLElement | null = null;
    private scrollListener: (() => void) | null = null;
    private isSyncingScroll = false;
    private handleIframeMessage = (event: MessageEvent) => {
        const data = event.data as { type?: string; sceneId?: string; scrollTop?: number };
        if (!data) return;

        if (data.type === 'iframe-scroll') {
            this.onIframeScroll(data.scrollTop || 0);
            return;
        }

        if (data.type !== 'scene-activated') return;

        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) return;

        const sceneId = data.sceneId;
        // Extract scene index from __scene_N format
        const match = sceneId?.match(/__scene_(\d+)/);
        if (!match) return;

        const blockIndex = parseInt(match[1], 10);
        if (blockIndex >= 0 && blockIndex < this.lastExtractedBlocks.length) {
            const block = this.lastExtractedBlocks[blockIndex];
            activeView.editor.setCursor({ line: block.startLine, ch: 0 });
            activeView.editor.scrollIntoView({ from: { line: block.startLine, ch: 0 }, to: { line: block.endLine, ch: 0 } });
        }
    };

    async onload() {
        await this.loadSettings();

        try {
            const vaultRoot = this.getVaultRootPath();
            const configDir = (this.app.vault as any).configDir || '.obsidian';
            if (vaultRoot && this.manifest?.id) {
                const pluginDir = path.join(vaultRoot, configDir, 'plugins', this.manifest.id);
                (globalThis as any).__REMOTION_PLUGIN_DIR = pluginDir;
            }
        } catch (err) {
            // Silently fail if plugin dir cannot be set
        }

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

        // Track cursor changes for focus sync
        this.registerEvent(
            this.app.workspace.on('editor-change', () => {
                this.scheduleFocusSync();
            })
        );

        // Listen for messages from iframe
        window.addEventListener('message', this.handleIframeMessage);

        // Initial check
        this.onActiveLeafChange();
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
            this.attachScrollListener(activeView);
        } else {
            // No markdown file active, but keep preview open if user wants it
            // (They can close it manually or toggle with ribbon icon)
            this.detachScrollListener();
        }
    }

    private attachScrollListener(activeView: MarkdownView) {
        // Clean up any existing listener
        this.detachScrollListener();

        const editorEl = (activeView.editor as any).cm;
        const scrollDOM = editorEl?.scrollDOM;
        
        if (scrollDOM) {
            this.currentScrollDOM = scrollDOM;
            this.scrollListener = () => {
                this.scheduleScrollSync();
            };
            scrollDOM.addEventListener('scroll', this.scrollListener);
        }
    }

    private detachScrollListener() {
        if (this.currentScrollDOM && this.scrollListener) {
            this.currentScrollDOM.removeEventListener('scroll', this.scrollListener);
        }
        this.currentScrollDOM = null;
        this.scrollListener = null;
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

    private scheduleFocusSync() {
        if (this.focusSyncTimeoutId !== null) {
            window.clearTimeout(this.focusSyncTimeoutId);
        }

        this.focusSyncTimeoutId = window.setTimeout(() => {
            this.focusSyncTimeoutId = null;
            this.onCursorChange();
        }, 50);
    }

    private scheduleScrollSync() {
        if (this.scrollSyncTimeoutId !== null) {
            window.clearTimeout(this.scrollSyncTimeoutId);
        }

        this.scrollSyncTimeoutId = window.setTimeout(() => {
            this.scrollSyncTimeoutId = null;
            this.syncScroll();
        }, 10);
    }

    private syncScroll() {
        if (this.isSyncingScroll) return;
        
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        const previewView = this.getPreviewView();
        
        if (!activeView || !previewView) return;

        const editorEl = (activeView.editor as any).cm;
        const scrollInfo = editorEl?.scrollDOM;
        
        if (scrollInfo) {
            const scrollTop = scrollInfo.scrollTop;
            this.isSyncingScroll = true;
            previewView.syncScroll(scrollTop);
            setTimeout(() => { this.isSyncingScroll = false; }, 100);
        }
    }

    private onIframeScroll(scrollTop: number) {
        if (this.isSyncingScroll) return;

        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) return;

        const editorEl = (activeView.editor as any).cm;
        const scrollDOM = editorEl?.scrollDOM;
        
        if (scrollDOM) {
            this.isSyncingScroll = true;
            scrollDOM.scrollTop = scrollTop;
            setTimeout(() => { this.isSyncingScroll = false; }, 100);
        }
    }

    private onCursorChange() {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        const previewView = this.getPreviewView();
        if (!activeView || !previewView) return;

        const blocks = extractCodeBlocks(activeView.editor.getValue());
        const classified = classifyBlocks(blocks);
        this.lastExtractedBlocks = classified;

        const cursorPos = activeView.editor.getCursor();
        const blockIndex = cursorToBlockIndex(cursorPos, blocks);

        // Only send message if block changed
        if (blockIndex !== this.lastCursorBlockIndex) {
            this.lastCursorBlockIndex = blockIndex;
            if (blockIndex !== null) {
                const sceneId = blockIndexToSceneId(blockIndex);
                previewView.focusScene(sceneId);
            }
        }
    }

    private async updatePreview() {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        const previewView = this.getPreviewView();
        if (!activeView || !previewView || !activeView.file) return;

        const blocks = extractCodeBlocks(activeView.editor.getValue());
        const classified = classifyBlocks(blocks);
        this.lastExtractedBlocks = classified;
        
        const notePath = activeView.file.path;
        const virtualFileName = `/virtual/${notePath}.tsx`;
        const synthesized = synthesizeVirtualModule(notePath, classified);
        const compiled = compileVirtualModule(virtualFileName, synthesized.code);

        const vaultRoot = this.getVaultRootPath();
        if (!vaultRoot) {
            previewView.updateBundleOutput('/* vault root unavailable */', []);
            return;
        }

        const absoluteNotePath = path.join(vaultRoot, notePath);
        const nodeModulesPaths = this.findNodeModulesPaths(path.dirname(absoluteNotePath), vaultRoot);
        const bundled = await bundleVirtualModule(compiled.code, virtualFileName, nodeModulesPaths);

        // Get editor metrics for spatial alignment
        const editorEl = (activeView.editor as any).cm;
        const lineHeight = editorEl?.defaultLineHeight || 20;
        
        // Map only JSX entry blocks to their pixel positions
        // (non-JSX blocks don't render players in the preview)
        const blockPositions = classified
            .filter(block => block.type === 'jsx-entry')
            .map(block => ({
                sceneId: blockIndexToSceneId(block.blockIndex),
                startLine: block.startLine,
                endLine: block.endLine,
                topOffset: block.startLine * lineHeight,
            }));

        previewView.updateBundleOutput(bundled.code || '/* no output */', blockPositions);
    }

    private getPreviewView(): PreviewView | null {
        const leaf = this.app.workspace.getLeavesOfType(PREVIEW_VIEW_TYPE)[0];
        return leaf?.view instanceof PreviewView ? (leaf.view as PreviewView) : null;
    }

    private getVaultRootPath(): string | null {
        const adapter = this.app.vault.adapter;
        if (adapter instanceof FileSystemAdapter) {
            const basePath = adapter.getBasePath();
            // Convert app:// protocol URLs to absolute file system paths
            if (basePath && basePath.startsWith('app://')) {
                // app://obsidian.md/path -> /path
                return basePath.replace(/^app:\/\/[^\/]+/, '');
            }
            return basePath;
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
        window.removeEventListener('message', this.handleIframeMessage);
        this.detachScrollListener();
        this.app.workspace.detachLeavesOfType(PREVIEW_VIEW_TYPE);
    }
}
