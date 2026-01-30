import { MarkdownView } from "obsidian";

export interface PreviewLocation {
  line: number;
  column: number;
  topOffset: number;
  height?: number;
  text: string;
  options?: Record<string, any>;
}

export class ScrollManager {
  private activeView: MarkdownView;
  private scrollableArea: HTMLElement;
  private iframe: HTMLIFrameElement;

  constructor(activeView: MarkdownView, iframe: HTMLIFrameElement) {
    this.activeView = activeView;
    this.iframe = iframe;
    this.scrollableArea = activeView.leaf.view.containerEl;
  }

  synchronizeHeight() {
    const scrollableHeight = this.scrollableArea.getBoundingClientRect().height;
    const iframeHeight =
      this.iframe.contentWindow?.document.body.scrollHeight || 0;
    const newHeight = Math.max(scrollableHeight, iframeHeight);
    this.iframe.style.height = `${newHeight}px`;
  }

  handlePreviewLocations(locations: PreviewLocation[]) {
    if (!Array.isArray(locations) || locations.length === 0) return;

    // Extract offsets from preview locations for validation
    const offsets = locations
      .filter(
        (loc): loc is PreviewLocation =>
          typeof loc === "object" && typeof loc.topOffset === "number",
      )
      .map((loc) => loc.topOffset);

    if (offsets.length > 0) {
      // Update height after processing offsets
      this.synchronizeHeight();
    }
  }

  getScrollableArea(): HTMLElement {
    return this.scrollableArea;
  }

  getIframe(): HTMLIFrameElement {
    return this.iframe;
  }
}
