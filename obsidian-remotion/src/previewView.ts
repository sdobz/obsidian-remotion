import { ItemView, WorkspaceLeaf } from 'obsidian';

export const PREVIEW_VIEW_TYPE = 'remotion-preview-view';

export class PreviewView extends ItemView {
    private iframe: HTMLIFrameElement | null = null;
    private handleMessage = (event: MessageEvent) => {
        const data = event.data as { type?: string; error?: { message?: string; stack?: string } };
        if (!data || data.type !== 'runtime-error') return;
        const message = data.error?.message ?? 'Unknown runtime error';
        const stack = data.error?.stack ?? '';
        console.error('Remotion runtime error:', message, stack);
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

        // Initialize iframe with a simple runtime that renders compiler output
        this.iframe.srcdoc = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                    * {
                        box-sizing: border-box;
                    }
                    html, body { 
                        margin: 0; 
                        padding: 0;
                        width: 100%;
                        height: 100%;
                        font-family: system-ui;
                        background: #1a1a1a;
                        color: #fff;
                    }
                    #players {
                        width: 100%;
                        padding: 12px;
                    }
                    #players > div {
                        position: relative;
                        width: 100%;
                        height: auto;
                    }
                    #players > div > * {
                        position: absolute;
                        top: 0;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        margin: auto;
                        aspectRatio: 1280 / 720;
                        maxHeight: 100%;
                        maxWidth: 100%;
                    }
                </style>
            </head>
            <body>
                <div id="players"></div>
                <script>
                    // Module registry for require polyfill
                    const __modules__ = {};
                    
                    // Minimal require polyfill - checks __modules__ and window globals
                    function require(id) {
                        if (__modules__[id]) return __modules__[id];
                        if (window[id]) return window[id];
                        if (window.__REMOTION_DEPS__ && window.__REMOTION_DEPS__[id]) return window.__REMOTION_DEPS__[id];
                        throw new Error('Module not found: ' + id);
                    }
                    
                    window.__REMOTION_DEPS__ = window.__REMOTION_DEPS__ || {};
                    let __root = null;

                    function renderPlayers(sequence) {
                        const deps = window.__REMOTION_DEPS__ || {};
                        const React = deps.react;
                        const PlayerModule = deps['@remotion/player'];
                        // Player could be default export, named export, or the module itself
                        const Player = (PlayerModule && PlayerModule.Player) || (PlayerModule && PlayerModule.default) || PlayerModule;
                        const ReactDomClient = deps['react-dom/client'] || deps['react-dom'];
                        const playersEl = document.getElementById('players');

                        if (!React || !ReactDomClient || !Player || !playersEl) {
                            console.error('[renderPlayers] Missing dependencies:', {
                                react: !!React,
                                player: !!Player,
                                reactDom: !!ReactDomClient,
                                playersEl: !!playersEl,
                                playerModule: PlayerModule ? Object.keys(PlayerModule) : 'undefined'
                            });
                            throw new Error('Missing React, ReactDOM, or @remotion/player');
                        }

                        const createRoot = ReactDomClient.createRoot || ReactDomClient.unstable_createRoot;
                        if (createRoot && !__root) {
                            __root = createRoot(playersEl);
                        }

                        const scenes = (sequence && sequence.scenes) || [];
                        const nodes = scenes.map((scene) => {
                            return React.createElement(
                                'div',
                                { key: scene.id, style: { marginBottom: '24px' } },
                                React.createElement(Player, {
                                    component: scene.component,
                                    durationInFrames: 150,
                                    fps: 30,
                                    compositionWidth: 1280,
                                    compositionHeight: 720,
                                    controls: true,
                                    acknowledgeRemotionLicense: true,
                                    style: { width: '100%' },
                                })
                            );
                        });

                        if (__root) {
                            __root.render(React.createElement(React.Fragment, null, ...nodes));
                        } else if (ReactDomClient.render) {
                            ReactDomClient.render(React.createElement(React.Fragment, null, ...nodes), playersEl);
                        }
                    }

                    function loadBundle(code) {
                        try {
                            window.RemotionBundle = undefined;
                            // eslint-disable-next-line no-eval
                            eval(code);
                            const mod = window.RemotionBundle;
                            // Handle both ESM (mod.default) and CommonJS (mod directly) formats
                            const sequence = (mod && mod.default) || mod;
                            if (!sequence || !sequence.scenes) {
                                throw new Error('Bundle did not export a default Sequence');
                            }
                            renderPlayers(sequence);
                        } catch (err) {
                            const message = err && err.message ? err.message : String(err);
                            window.parent.postMessage({
                                type: 'runtime-error',
                                error: { message, stack: err && err.stack ? err.stack : '' }
                            }, '*');
                        }
                    }

                    window.addEventListener('message', (event) => {
                        const data = event.data;
                        if (!data || data.type !== 'bundle-output') return;
                        if (data.payload) {
                            loadBundle(data.payload);
                        }
                    });

                    window.parent.postMessage({ type: 'iframe-ready' }, '*');
                </script>
            </body>
            </html>
        `;

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
        console.log('[PreviewView] injectDependencies() called');
        if (!this.iframe?.contentWindow) {
            console.log('[PreviewView] No iframe contentWindow');
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
                console.log('[PreviewView] createRequire failed:', e);
            }

            if (!req) {
                const winReq = (window as any).require;
                if (typeof winReq === 'function') req = winReq;
            }

            console.log('[PreviewView] require available:', typeof req === 'function');
            if (typeof req === 'function') {
                // Set up __REMOTION_DEPS__ object with all dependencies
                const deps: any = {};
                try { deps.react = req('react'); console.log('[PreviewView] react loaded'); } catch (e) { console.log('[PreviewView] Failed to require react:', e); }
                try { deps.remotion = req('remotion'); console.log('[PreviewView] remotion loaded'); } catch (e) { console.log('[PreviewView] Failed to require remotion:', e); }
                try { deps['react-dom'] = req('react-dom'); console.log('[PreviewView] react-dom loaded'); } catch (e) { console.debug('Failed to require react-dom:', e); }
                try { deps['react-dom/client'] = req('react-dom/client'); console.log('[PreviewView] react-dom/client loaded'); } catch (e) { console.debug('Failed to require react-dom/client:', e); }
                try { deps['@remotion/player'] = req('@remotion/player'); console.log('[PreviewView] @remotion/player loaded'); } catch (e) { console.debug('Failed to require @remotion/player:', e); }
                
                (this.iframe.contentWindow as any).__REMOTION_DEPS__ = deps;
                console.log('[PreviewView] Dependencies injected:', Object.keys(deps));
            }
        } catch (e) {
            console.debug('Dependency injection failed:', e);
        }
    }

    public updateBundleOutput(code: string) {
        if (!this.iframe?.contentWindow) return;
        this.iframe.contentWindow.postMessage({
            type: 'bundle-output',
            payload: code,
        }, '*');
    }
}
