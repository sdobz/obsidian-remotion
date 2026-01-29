import { ItemView, WorkspaceLeaf } from 'obsidian';
import iframeHtml from './iframe.html';

export const PREVIEW_VIEW_TYPE = 'remotion-preview-view';

export class PreviewView extends ItemView {
    private iframe: HTMLIFrameElement | null = null;
    private handleMessage = (event: MessageEvent) => {
        const data = event.data as { type?: string; error?: { message?: string; stack?: string }; sceneId?: string };
        if (!data) return;

        if (data.type === 'runtime-error') {
            const message = data.error?.message ?? 'Unknown runtime error';
            const stack = data.error?.stack ?? '';
            console.error('Remotion runtime error:', message, stack);
        } else if (data.type === 'scene-activated') {
            // Forward scene activation to parent plugin
            window.parent.postMessage({
                type: 'scene-activated',
                sceneId: data.sceneId,
            }, '*');
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

    private injectDependencies() {
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
                try { deps.react = req('react'); } catch (e) { /* ignore */ }
                try { deps.remotion = req('remotion'); } catch (e) { /* ignore */ }
                try { deps['react-dom'] = req('react-dom'); } catch (e) { /* ignore */ }
                try { deps['react-dom/client'] = req('react-dom/client'); } catch (e) { /* ignore */ }
                try { deps['@remotion/player'] = req('@remotion/player'); } catch (e) { /* ignore */ }
                
                (this.iframe.contentWindow as any).__REMOTION_DEPS__ = deps;
            }
        } catch (e) {
            console.debug('Dependency injection failed:', e);
        }
    }

    public updateBundleOutput(code: string, blockPositions: Array<{sceneId: string, startLine: number, endLine: number, topOffset: number}>) {
        if (!this.iframe?.contentWindow) return;
        this.iframe.contentWindow.postMessage({
            type: 'bundle-output',
            payload: code,
            blockPositions,
        }, '*');
    }

    public focusScene(sceneId: string) {
        if (!this.iframe?.contentWindow) return;
        this.iframe.contentWindow.postMessage({
            type: 'focus-scene',
            sceneId,
        }, '*');
    }

    public syncScroll(scrollTop: number) {
        if (!this.iframe?.contentWindow) {
            return;
        }
        this.iframe.contentWindow.postMessage({
            type: 'sync-scroll',
            scrollTop,
        }, '*');
    }
}
