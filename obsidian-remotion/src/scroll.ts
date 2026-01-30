import { EditorView } from "@codemirror/view";
import { PreviewSpan } from "remotion-md";

export interface PixelBand {
  topOffset: number;
  height: number;
}

export interface PlayerPosition {
  index: number;
  actualOffset: number;
  height: number;
}

export type ViewportState = {
  scrollTop: number;
  scrollOffset: number;
  editorHeight: number;
  iframeHeight: number;
};

/**
 * Delegate interface for ScrollManager to communicate viewport, bands, and positions
 */
export interface ScrollDelegate {
  onViewportSync(state: ViewportState): void;
  onPreviewBandsUpdate(bands: PixelBand[]): void;
  onPlayerPositionsUpdate(positions: PlayerPosition[]): void;
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
  private scrollListener: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    private scrollDOM: HTMLElement,
    private container: HTMLElement,
    private editorView: EditorView,
    private delegate: ScrollDelegate,
  ) {
    this.setupScrollListener();
    this.setupResizeObserver();
  }

  /**
   * Get unified viewport state for iframe synchronization
   */
  getViewportState(): ViewportState {
    const scrollOffset = this.getScrollOffset();
    const scrollTop = this.scrollDOM.scrollTop || 0;
    const containerHeight = this.container.clientHeight;
    const totalHeight = Math.max(
      this.scrollDOM.scrollHeight + scrollOffset,
      containerHeight,
    );

    return {
      scrollTop,
      scrollOffset,
      editorHeight: this.scrollDOM.scrollHeight,
      iframeHeight: totalHeight,
    };
  }

  /**
   * Notify viewport changes (height and scroll position)
   */
  private notifyViewportSync(): void {
    const state = this.getViewportState();
    this.delegate.onViewportSync(state);

    console.log(
      `[ScrollSync] Viewport changed: scrollTop=${state.scrollTop}, iframeHeight=${state.iframeHeight}`,
    );
  }

  /**
   * Set up scroll event listener to notify viewport changes
   */
  private setupScrollListener(): void {
    console.log("[Scroll] Setting up scroll listener");
    this.scrollListener = () => {
      this.notifyViewportSync();
    };
    this.scrollDOM.addEventListener("scroll", this.scrollListener);
  }

  /**
   * Set up resize observer to notify viewport changes on window reflow
   */
  private setupResizeObserver(): void {
    if (typeof ResizeObserver === "undefined") return;

    this.resizeObserver = new ResizeObserver(() => {
      this.notifyViewportSync();
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
   * Pipeline: Convert semantic spans to pixel bands and update positions
   * Single-pass processing without intermediate state
   */
  private updatePlayerBands(): void {
    if (!this.editorView || this.previewSpans.length === 0) {
      this.delegate.onPreviewBandsUpdate([]);
      this.delegate.onPlayerPositionsUpdate([]);
      return;
    }

    const viewport = this.getViewportState();
    const bands = this.convertToBands(viewport);

    if (bands.length === 0) {
      this.delegate.onPreviewBandsUpdate([]);
      this.delegate.onPlayerPositionsUpdate([]);
      return;
    }

    requestAnimationFrame(() => {
      this.delegate.onPreviewBandsUpdate(bands);

      // Calculate player positions
      const positions = this.calculatePlayerPositions(bands);
      this.delegate.onPlayerPositionsUpdate(positions);

      this.notifyViewportSync();
    });
  }

  /**
   * Convert semantic spans to pixel bands using viewport state
   * Uses span.pos and span.length to calculate full span height
   */
  private convertToBands(
    viewport: ReturnType<typeof this.getViewportState>,
  ): PixelBand[] {
    return this.previewSpans
      .map((span) => {
        try {
          const startCoords = this.editorView.coordsAtPos(span.pos);
          const endCoords = this.editorView.coordsAtPos(
            span.pos + (span.length || 0),
          );

          if (!startCoords || !endCoords) return null;

          const height = Math.max(7, endCoords.bottom - startCoords.top);
          const topOffset =
            startCoords.top + viewport.scrollOffset + viewport.scrollTop;

          return { topOffset, height };
        } catch {
          return null;
        }
      })
      .filter((band): band is PixelBand => band !== null);
  }

  /**
   * Calculate player positions with collision detection
   */
  private calculatePlayerPositions(bands: PixelBand[]): PlayerPosition[] {
    // For now, use a default height; Preview will provide actual heights
    const defaultHeight = 400;

    // Calculate priority-sorted positions by distance from viewport center
    const viewportCenter = window.innerHeight / 2;
    const positions: PlayerPosition[] = bands
      .map((band, index) => ({
        index,
        actualOffset: band.topOffset,
        height: defaultHeight,
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
    }

    return placed;
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
}
