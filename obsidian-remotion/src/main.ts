import { Plugin, WorkspaceLeaf, MarkdownView, FileSystemAdapter } from 'obsidian';
import { PreviewView, PREVIEW_VIEW_TYPE } from './previewView';
import { PluginSettings, DEFAULT_SETTINGS, RemotionSettingTab } from './settings';
import { editorDiagnosticsExtension } from './editorDiagnostics';
import { CompilationManager } from './compilationManager';
import { ViewManager } from './viewManager';
import path from 'path';
import fs from 'fs';

export default class RemotionPlugin extends Plugin {
    public settings!: PluginSettings;
    private compilationManager!: CompilationManager;
    private viewManager!: ViewManager;
    private typecheckStatusBarItem: HTMLElement | null = null;
    private bundleStatusBarItem: HTMLElement | null = null;

    async onload() {
        await this.loadSettings();

        this.registerEditorExtension(editorDiagnosticsExtension);

        // Initialize managers
        const vaultRoot = this.getVaultRootPath();
        if (vaultRoot) {
            this.compilationManager = new CompilationManager(vaultRoot, this.findNodeModulesPaths.bind(this));
        }
        this.viewManager = new ViewManager(this.app);

        // Set plugin directory for runtime
        this.setupPluginDirectory(vaultRoot);

        // Create status bar items
        this.typecheckStatusBarItem = this.addStatusBarItem();
        this.typecheckStatusBarItem.setText('📝 Types');
        
        this.bundleStatusBarItem = this.addStatusBarItem();
        this.bundleStatusBarItem.setText('📦 Bundle');

        // Register the Remotion preview view
        this.registerView(PREVIEW_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
            const view = new PreviewView(leaf);
            view.setStatusCallback((typecheck, bundle) => {
                this.updateStatusBarItems(typecheck, bundle);
            });
            return view;
        });

        this.addRibbonIcon('video', 'Toggle Remotion Preview', async () => {
            await this.viewManager.toggle();
        });

        // Add settings tab
        this.addSettingTab(new RemotionSettingTab(this.app, this));

        // Register event handlers
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => this.onActiveLeafChange())
        );

        this.registerEvent(
            this.app.workspace.on('editor-change', () => this.schedulePreviewUpdate())
        );

        // Initial check
        this.onActiveLeafChange();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private setupPluginDirectory(vaultRoot: string | null): void {
        try {
            const configDir = (this.app.vault as any).configDir || '.obsidian';
            if (vaultRoot && this.manifest?.id) {
                const pluginDir = path.join(vaultRoot, configDir, 'plugins', this.manifest.id);
                (globalThis as any).__REMOTION_PLUGIN_DIR = pluginDir;
            }
        } catch (err) {
            // Silently fail if plugin dir cannot be set
        }
    }

    private async onActiveLeafChange() {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        
        if (activeView) {
            // Don't auto-activate preview panel on file switch
            // User must manually open it via ribbon icon
            const previewView = this.viewManager.getPreviewView();
            if (previewView) {
                // Reset panel on note transition
                previewView.resetForNewFile();
            }
            this.schedulePreviewUpdate();
        } else {
            this.compilationManager?.clearDiagnostics(activeView);
        }
    }

    private schedulePreviewUpdate(): void {
        if (!this.compilationManager) return;
        
        this.compilationManager.scheduleUpdate(async () => {
            await this.updatePreview();
        });
    }

    private async updatePreview(): Promise<void> {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        const previewView = this.viewManager.getPreviewView();
        if (!activeView || !previewView) return;

        const version = this.compilationManager.getCurrentVersion();
        const result = await this.compilationManager.compile(activeView, previewView, version);
        
        if (!result) return;

        previewView.updateBundleOutput(
            result.bundleCode,
            result.previewLocations,
            result.runtimeModules
        );
    }

    private getVaultRootPath(): string | null {
        const adapter = this.app.vault.adapter;
        if (adapter instanceof FileSystemAdapter) {
            const basePath = adapter.getBasePath();
            if (basePath && basePath.startsWith('app://')) {
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

        const rootNodeModules = path.join(rootDir, 'node_modules');
        if (fs.existsSync(rootNodeModules) && !paths.includes(rootNodeModules)) {
            paths.push(rootNodeModules);
        }

        current = rootDir;
        while (true) {
            const parent = path.dirname(current);
            if (parent === current) break;
            
            const candidate = path.join(parent, 'node_modules');
            if (fs.existsSync(candidate) && !paths.includes(candidate)) {
                paths.push(candidate);
                break;
            }
            
            current = parent;
        }

        return paths;
    }

    async onunload() {
        this.app.workspace.detachLeavesOfType(PREVIEW_VIEW_TYPE);
        this.typecheckStatusBarItem = null;
        this.bundleStatusBarItem = null;
    }

    private updateStatusBarItems(
        typecheck?: { status: string; errorCount: number },
        bundle?: { status: string; error: string | null }
    ) {
        if (typecheck && this.typecheckStatusBarItem) {
            let icon = '📝';
            let text = 'Types';
            let color = '';
            
            if (typecheck.status === 'loading') {
                icon = '⏳';
                text = 'Types...';
            } else if (typecheck.status === 'ok') {
                icon = '✓';
                color = 'color: var(--text-success);';
            } else {
                icon = '✗';
                color = 'color: var(--text-error);';
                if (typecheck.errorCount > 0) {
                    text = `Types (${typecheck.errorCount})`;
                }
            }
            
            this.typecheckStatusBarItem.setText(`${icon} ${text}`);
            this.typecheckStatusBarItem.style.cssText = color;
        }

        if (bundle && this.bundleStatusBarItem) {
            let icon = '📦';
            let text = 'Bundle';
            let color = '';
            
            if (bundle.status === 'loading') {
                icon = '⏳';
                text = 'Bundle...';
            } else if (bundle.status === 'ok') {
                icon = '✓';
                color = 'color: var(--text-success);';
            } else {
                icon = '✗';
                color = 'color: var(--text-error);';
            }
            
            this.bundleStatusBarItem.setText(`${icon} ${text}`);
            this.bundleStatusBarItem.style.cssText = color;
        }
    }
}
