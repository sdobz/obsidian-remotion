import type { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { PreviewSpan } from "remotion-md";

interface PixelBand {
  topOffset: number;
  height: number;
}

interface PlayerPosition {
  index: number;
  actualOffset: number;
  height: number;
}

// ============================================================================
// Scroll and Band Management
//
// Flow: SemanticSpans → PixelBands → PlayerPositions → Viewport
//
// All calculations depend on current editor scroll state. When scroll/height
// changes, positions are recalculated. We store semantic spans for replay.
// ============================================================================

export class ScrollManager {
  private previewSpans: PreviewSpan[] = [];
  private doc: Text | null = null;
  private scrollListener: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    private scrollDOM: HTMLElement,
    private container: HTMLElement,
    private iframe: HTMLIFrameElement,
    private editorView: EditorView,
  ) {
    this.doc = this.editorView?.state?.doc ?? null;
    this.setupScrollListener();
    this.setupResizeObserver();
  }

  /**
   * Get unified viewport state for iframe synchronization
   */
  private getViewportState() {
    const scrollOffset = this.getScrollOffset();
    const scrollTop = this.scrollDOM.scrollTop || 0;
    const iframeContentHeight =
      this.iframe.contentWindow?.document.body?.scrollHeight || 0;
    const totalHeight = Math.max(
      this.scrollDOM.scrollHeight + scrollOffset,
      iframeContentHeight,
    );

    return {
      scrollTop,
      scrollOffset,
      editorHeight: this.scrollDOM.scrollHeight,
      iframeHeight: totalHeight,
    };
  }

  /**
   * Sync viewport state to iframe (scroll position and height)
   */
  private syncViewport(): void {
    if (!this.iframe.contentWindow) return;

    const state = this.getViewportState();
    this.iframe.contentWindow.postMessage(
      {
        type: "viewport-sync",
        scrollTop: state.scrollTop,
        iframeHeight: state.iframeHeight,
      },
      "*",
    );

    this.iframe.style.height = `${state.iframeHeight}px`;
  }

  /**
   * Set up scroll event listener to sync viewport state with iframe
   */
  private setupScrollListener(): void {
    this.scrollListener = () => {
      this.syncViewport();
    };
    this.scrollDOM.addEventListener("scroll", this.scrollListener);
  }

  /**
   * Set up resize observer to resync viewport on window reflow
   */
  private setupResizeObserver(): void {
    if (typeof ResizeObserver === "undefined") return;

    this.resizeObserver = new ResizeObserver(() => {
      this.syncViewport();
    });

    this.resizeObserver.observe(this.scrollDOM);
  }

  /**
   * Clean up listeners and observers
   */
  destroy(): void {
    if (this.scrollListener) {
      this.scrollDOM.removeEventListener("scroll", this.scrollListener);
      this.scrollListener = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  /**
   * Calculate the scroll offset (from scrollDOM top to container top)
   */
  private getScrollOffset(): number {
    const scrollRect = this.scrollDOM.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();
    return containerRect.top - scrollRect.top;
  }

  /**
   * Ingest and position preview spans: store for replay, then pipeline through
   * conversion and positioning in a single pass
   */
  handlePreviewSpans(locations: PreviewSpan[]): void {
    this.previewSpans = locations;
    this.updatePlayerBands();
  }

  /**
   * Replay stored spans (e.g., after players-rendered event)
   */
  replayPreviewSpans(): void {
    if (this.previewSpans.length > 0) {
      this.updatePlayerBands();
    }
  }

  /**
   * Pipeline: Convert semantic spans to pixel bands and position players
   * Single-pass processing without intermediate state
   */
  private updatePlayerBands(): void {
    if (!this.editorView || !this.doc || this.previewSpans.length === 0) {
      this.clearPlayerPositions();
      return;
    }

    const viewport = this.getViewportState();
    const bands = this.convertToBands(viewport);

    if (bands.length === 0) {
      this.clearPlayerPositions();
      return;
    }

    requestAnimationFrame(() => {
      this.positionPlayers(bands);
      this.syncViewport();
    });
  }

  /**
   * Convert semantic spans to pixel bands using viewport state
   * Pairs semantic and pixel data during single iteration
   */
  private convertToBands(
    viewport: ReturnType<typeof this.getViewportState>,
  ): PixelBand[] {
    return this.previewSpans
      .map((span) => {
        try {
          const lineInfo = this.doc!.line(span.line);
          const pos = lineInfo.from + Math.min(span.column, lineInfo.length);
          const coords = this.editorView.coordsAtPos(pos);

          if (!coords) return null;

          const height = Math.max(7, coords.bottom - coords.top);
          const topOffset =
            coords.top + viewport.scrollOffset + viewport.scrollTop;

          return { topOffset, height };
        } catch {
          return null;
        }
      })
      .filter((band): band is PixelBand => band !== null);
  }

  /**
   * Position players with collision detection, all in one pass
   */
  private positionPlayers(bands: PixelBand[]): void {
    const playersContainer =
      this.iframe.contentWindow?.document.getElementById("players");
    const playerElements = Array.from(
      playersContainer?.children || [],
    ) as HTMLElement[];

    if (playerElements.length === 0) return;

    // Get player heights
    const playerHeights = playerElements.map(
      (el) => el.getBoundingClientRect().height || 400,
    );

    // Calculate priority-sorted positions by distance from viewport center
    const viewportCenter = window.innerHeight / 2;
    const positions: PlayerPosition[] = bands
      .map((band, index) => ({
        index,
        actualOffset: band.topOffset,
        height: playerHeights[index] || 400,
        distanceFromCenter: Math.abs(band.topOffset - viewportCenter),
      }))
      .sort((a, b) => a.distanceFromCenter - b.distanceFromCenter)
      .map(({ index, height, actualOffset }) => ({
        index,
        actualOffset,
        height,
      }));

    // Resolve collisions
    const placed: PlayerPosition[] = [];
    for (const pos of positions) {
      pos.actualOffset = this.resolveCollisions(
        pos.actualOffset,
        pos.height,
        placed,
      );
      placed.push(pos);

      const element = playerElements[pos.index];
      if (element) {
        element.style.position = "absolute";
        element.style.top = `${Math.max(0, pos.actualOffset)}px`;
        element.style.left = "0";
        element.style.right = "0";
      }
    }

    // Update container sizing
    playersContainer!.style.position = "relative";
    const maxBottom = Math.max(
      ...placed.map((p) => p.actualOffset + p.height),
      0,
    );
    if (maxBottom > 0) {
      playersContainer!.style.minHeight = `${maxBottom + 20}px`;
    }
  }

  /**
   * Resolve position collisions by finding clearance
   */
  private resolveCollisions(
    desired: number,
    height: number,
    placed: PlayerPosition[],
  ): number {
    const margin = 16;
    let offset = desired;

    for (let iteration = 0; iteration < 5; iteration++) {
      let hasCollision = false;

      for (const p of placed) {
        const overlap =
          offset < p.actualOffset + p.height + margin &&
          offset + height + margin > p.actualOffset;

        if (overlap) {
          hasCollision = true;
          const pushDown = p.actualOffset + p.height + margin;
          const pushUp = p.actualOffset - height - margin;

          offset =
            pushUp < 0
              ? pushDown
              : Math.abs(pushUp - desired) < Math.abs(pushDown - desired)
                ? pushUp
                : pushDown;
        }
      }

      if (!hasCollision) break;
    }

    return offset;
  }

  /**
   * Clear all player positions
   */
  private clearPlayerPositions(): void {
    const playersContainer =
      this.iframe.contentWindow?.document.getElementById("players");
    if (playersContainer) {
      playersContainer.style.minHeight = "0";
      Array.from(playersContainer.children).forEach((child) => {
        (child as HTMLElement).style.position = "static";
        (child as HTMLElement).style.top = "";
      });
    }
  }
}
