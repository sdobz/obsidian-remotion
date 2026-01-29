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

        // TODO: Initialize iframe with Remotion runtime
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
                </style>
            </head>
            <body>
                <h2>Remotion Preview</h2>
                <p>Preview panel initialized. Awaiting scene compilation...</p>
            </body>
            </html>
        `;
    }

    async onClose() {
        this.iframe = null;
    }
}
