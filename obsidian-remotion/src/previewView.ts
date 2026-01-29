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
                    body { 
                        margin: 0; 
                        padding: 20px;
                        font-family: system-ui;
                        background: #1a1a1a;
                        color: #fff;
                    }
                    pre {
                        white-space: pre-wrap;
                        word-break: break-word;
                        background: #111;
                        padding: 12px;
                        border-radius: 6px;
                        border: 1px solid #333;
                    }
                </style>
            </head>
            <body>
                <h2>Remotion Preview</h2>
                <p>Preview panel initialized. Awaiting bundle output...</p>
                <div id="players"></div>
                <pre id="extract-output">No data yet</pre>
                <script>
                    window.__REMOTION_DEPS__ = window.__REMOTION_DEPS__ || {};
                    let __root = null;

                    function renderPlayers(sequence) {
                        const deps = window.__REMOTION_DEPS__ || {};
                        const React = deps.react;
                        const PlayerModule = deps['@remotion/player'];
                        const Player = PlayerModule && (PlayerModule.Player || PlayerModule.default || PlayerModule);
                        const ReactDomClient = deps['react-dom/client'] || deps['react-dom'];
                        const playersEl = document.getElementById('players');

                        if (!React || !ReactDomClient || !Player || !playersEl) {
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
                            const sequence = mod && mod.default ? mod.default : null;
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
                        if (data && data.type === 'set-deps') {
                            window.__REMOTION_DEPS__ = data.payload || {};
                            return;
                        }
                        if (!data || data.type !== 'bundle-output') return;
                        const pre = document.getElementById('extract-output');
                        pre.textContent = data.payload || 'No data';
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
        if (!this.iframe?.contentWindow) return;

        const deps: Record<string, unknown> = {};
        try {
            const req = (window as any).require;
            if (typeof req === 'function') {
                deps.react = req('react');
                deps.remotion = req('remotion');
                deps['react-dom'] = req('react-dom');
                deps['react-dom/client'] = req('react-dom/client');
                deps['@remotion/player'] = req('@remotion/player');
            }
        } catch {
            // Ignore if deps are not available in this environment
        }

        (this.iframe.contentWindow as any).__REMOTION_DEPS__ = deps;
        this.iframe.contentWindow.postMessage({ type: 'set-deps', payload: deps }, '*');
    }

    public updateBundleOutput(code: string) {
        if (!this.iframe?.contentWindow) return;
        this.iframe.contentWindow.postMessage({
            type: 'bundle-output',
            payload: code,
        }, '*');
    }
}
