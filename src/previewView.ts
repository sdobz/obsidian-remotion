import { ItemView, WorkspaceLeaf } from 'obsidian';

export const PREVIEW_VIEW_TYPE = 'remotion-preview-view';

export class PreviewView extends ItemView {
    private iframe: HTMLIFrameElement | null = null;

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

        // Initialize iframe with a simple runtime that renders synthesized module output
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
                <p>Preview panel initialized. Awaiting synthesized module...</p>
                <pre id="extract-output">No data yet</pre>
                <script>
                    window.addEventListener('message', (event) => {
                        const data = event.data;
                        if (!data || data.type !== 'synthesized-module') return;
                        const pre = document.getElementById('extract-output');
                        pre.textContent = data.payload || 'No data';
                    });
                </script>
            </body>
            </html>
        `;
    }

    async onClose() {
        this.iframe = null;
    }

    public updateSynthesizedModule(code: string) {
        if (!this.iframe?.contentWindow) return;
        this.iframe.contentWindow.postMessage({
            type: 'synthesized-module',
            payload: code,
        }, '*');
    }
}
