import { Plugin, WorkspaceLeaf, MarkdownView, FileSystemAdapter } from 'obsidian';
import { PreviewView, PREVIEW_VIEW_TYPE } from './previewView';
import { PluginSettings, DEFAULT_SETTINGS, RemotionSettingTab } from './settings';
import { extractCodeBlocks, classifyBlocks, synthesizeVirtualModule, compileVirtualModule, mapDiagnosticsToMarkdown, parseBundleError } from 'remotion-md';
import { bundleVirtualModule } from './bundler';
import { cursorToBlockIndex, blockIndexToSceneId } from './focusSync';
import { editorDiagnosticsExtension, applyEditorDiagnostics, clearEditorDiagnostics } from './editorDiagnostics';
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
    private updateVersion = 0;
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

        this.registerEditorExtension(editorDiagnosticsExtension);

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
            this.clearActiveEditorDiagnostics();
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
            this.updateVersion += 1;
            const version = this.updateVersion;
            void this.updatePreview(version);
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
        }, 5);
    }

    private syncScroll() {
        if (this.isSyncingScroll) return;
        
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        const previewView = this.getPreviewView();
        
        if (!activeView || !previewView) return;

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

    private onIframeScroll(scrollTop: number) {
        if (this.isSyncingScroll) return;

        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) return;

        const editorEl = (activeView.editor as any).cm;
        const scrollDOM = editorEl?.scrollDOM;
        
        if (scrollDOM) {
            this.isSyncingScroll = true;
            scrollDOM.scrollTop = scrollTop;
            setTimeout(() => { this.isSyncingScroll = false; }, 50);
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

    private async updatePreview(version: number) {
        const startTime = performance.now();
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        const previewView = this.getPreviewView();
        if (!activeView || !previewView || !activeView.file) return;

        const blocks = extractCodeBlocks(activeView.editor.getValue());
        const classified = classifyBlocks(blocks);
        this.lastExtractedBlocks = classified;
        
        const notePath = activeView.file.path;
        const synthesized = synthesizeVirtualModule(notePath, classified);
        
        const vaultRoot = this.getVaultRootPath();
        if (!vaultRoot) {
            previewView.updateBundleOutput('/* vault root unavailable */', []);
            return;
        }

        const absoluteNotePath = path.join(vaultRoot, notePath);
        // Use real file path with .tsx extension for TypeScript and esbuild
        const virtualFileName = absoluteNotePath.replace(/\.md$/, '.tsx');
        const nodeModulesPaths = this.findNodeModulesPaths(path.dirname(absoluteNotePath), vaultRoot);
        
        const tsStart = performance.now();
        const compiled = compileVirtualModule(virtualFileName, synthesized.code, nodeModulesPaths);
        const tsEnd = performance.now();
        
        let markdownDiagnostics = mapDiagnosticsToMarkdown(compiled.diagnostics, synthesized.code, classified, synthesized.sceneExports);
        if (version !== this.updateVersion) return;
        
        const bundleStart = performance.now();
        const bundled = await bundleVirtualModule(compiled.code, virtualFileName, nodeModulesPaths, compiled.runtimeModules);
        const bundleEnd = performance.now();
        
        if (version !== this.updateVersion) return;

        // Add bundle errors to diagnostics
        if (bundled.error) {
            const bundleError = parseBundleError(bundled.error, classified);
            if (bundleError) {
                markdownDiagnostics = [...markdownDiagnostics, bundleError];
            }
        }

        this.updateEditorDiagnostics(activeView, markdownDiagnostics);

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

        previewView.updateBundleOutput(bundled.code || '/* no output */', blockPositions, compiled.runtimeModules);
        
        const endTime = performance.now();
        const totalTime = endTime - startTime;
        const tsTime = tsEnd - tsStart;
        const bundleTime = bundleEnd - bundleStart;
        const reloadTime = endTime - bundleEnd;
        
        console.log(`[remotion] TypeScript: ${tsTime.toFixed(1)}ms | Bundle: ${bundleTime.toFixed(1)}ms | Reload: ${reloadTime.toFixed(1)}ms | Total: ${totalTime.toFixed(1)}ms`);
    }

    private updateEditorDiagnostics(activeView: MarkdownView, diagnostics: ReturnType<typeof mapDiagnosticsToMarkdown>) {
        const cm = (activeView.editor as any).cm;
        if (!cm || typeof cm.dispatch !== 'function') return;

        if (diagnostics.length === 0) {
            clearEditorDiagnostics(cm);
            return;
        }

        applyEditorDiagnostics(cm, diagnostics);
    }

    private clearActiveEditorDiagnostics() {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) return;
        const cm = (activeView.editor as any).cm;
        if (!cm || typeof cm.dispatch !== 'function') return;
        clearEditorDiagnostics(cm);
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

        // Walk up directory tree looking for node_modules (within vault)
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

        // Always include root vault node_modules
        const rootNodeModules = path.join(rootDir, 'node_modules');
        if (fs.existsSync(rootNodeModules) && !paths.includes(rootNodeModules)) {
            paths.push(rootNodeModules);
        }

        // Also search up PAST the vault root to find workspace node_modules
        // (for cases where vault is nested inside a workspace)
        current = rootDir;
        while (true) {
            const parent = path.dirname(current);
            if (parent === current) break;
            
            const candidate = path.join(parent, 'node_modules');
            if (fs.existsSync(candidate) && !paths.includes(candidate)) {
                console.debug('[plugin] Found workspace node_modules at:', candidate);
                paths.push(candidate);
                break;
            }
            
            current = parent;
        }

        return paths;
    }

    async onunload() {
        window.removeEventListener('message', this.handleIframeMessage);
        this.detachScrollListener();
        this.app.workspace.detachLeavesOfType(PREVIEW_VIEW_TYPE);
    }
}
