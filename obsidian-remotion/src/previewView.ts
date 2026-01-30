import { ItemView, WorkspaceLeaf } from 'obsidian';
import iframeHtml from './iframe.html';

export const PREVIEW_VIEW_TYPE = 'remotion-preview-view';

export class PreviewView extends ItemView {
    private iframe: HTMLIFrameElement | null = null;
    private handleMessage = (event: MessageEvent) => {
        const data = event.data as { type?: string; error?: { message?: string; stack?: string } };
        if (!data) return;

        if (data.type === 'runtime-error') {
            const message = data.error?.message ?? 'Unknown runtime error';
            const stack = data.error?.stack ?? '';
            console.error('Remotion runtime error:', message, stack);
        }
    };

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
        this.icon = 'video';
    }

    getViewType(): string {
        return PREVIEW_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'Remotion Preview';
    }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('remotion-preview-container');

        // Create iframe for Remotion runtime
        this.iframe = container.createEl('iframe', {
            cls: 'remotion-preview-iframe',
        });
        this.iframe.style.width = '100%';
        this.iframe.style.height = '100%';
        this.iframe.style.border = 'none';
        this.iframe.style.backgroundColor = '#000';

        // Load iframe HTML from bundled file
        this.iframe.srcdoc = iframeHtml;

        this.iframe.addEventListener('load', () => {
            this.injectDependencies();
        });

        window.addEventListener('message', this.handleMessage);
    }

    async onClose() {
        window.removeEventListener('message', this.handleMessage);
        this.iframe = null;
    }

    private injectDependencies(requiredModules?: Set<string>) {
        if (!this.iframe?.contentWindow) {
            return;
        }

        try {
            let req: ((id: string) => unknown) | undefined;
            try {
                const { createRequire } = require('module');
                const adapter = this.app.vault.adapter as any;
                if (adapter && typeof adapter.getBasePath === 'function') {
                    const basePath = adapter.getBasePath();
                    const vaultRoot = basePath && basePath.startsWith('app://')
                        ? basePath.replace(/^app:\/\/[^\/]+/, '')
                        : basePath;
                    if (vaultRoot) {
                        const anchor = require('path').join(vaultRoot, 'package.json');
                        req = createRequire(anchor);
                    }
                }
            } catch (e) {
                // Silently fail if createRequire is unavailable
            }

            if (!req) {
                const winReq = (window as any).require;
                if (typeof winReq === 'function') req = winReq;
            }

            if (typeof req === 'function') {
                // Set up __REMOTION_DEPS__ object with all dependencies
                const deps: any = {};
                
                // Always try to load core dependencies
                const coreModules = ['react', 'remotion', 'react-dom', 'react-dom/client', '@remotion/player'];
                
                // Add any additional runtime modules if specified
                if (requiredModules) {
                    for (const mod of requiredModules) {
                        if (!coreModules.includes(mod)) {
                            coreModules.push(mod);
                        }
                    }
                }
                
                // Try to load each module
                for (const modName of coreModules) {
                    try {
                        deps[modName] = req(modName);
                    } catch (e) {
                        // Silently ignore missing modules
                    }
                }
                
                (this.iframe.contentWindow as any).__REMOTION_DEPS__ = deps;
            }
        } catch (e) {
            console.debug('Dependency injection failed:', e);
        }
    }

    public updateBundleOutput(code: string, previewLocations: Array<{line: number, column: number, topOffset: number, text: string, options?: Record<string, any>}>, runtimeModules?: Set<string>) {
        if (!this.iframe?.contentWindow) return;
        
        // Reload dependencies if new modules are required
        if (runtimeModules && runtimeModules.size > 0) {
            this.injectDependencies(runtimeModules);
        }
        
        this.iframe.contentWindow.postMessage({
            type: 'bundle-output',
            payload: code,
            previewLocations,
        }, '*');
    }

    public syncScroll(scrollTop: number, viewportHeight?: number) {
        if (!this.iframe?.contentWindow) {
            return;
        }
        this.iframe.contentWindow.postMessage({
            type: 'sync-scroll',
            scrollTop,
            viewportHeight,
        }, '*');
    }
}
