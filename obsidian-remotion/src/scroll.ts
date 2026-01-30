import type { EditorView } from "@codemirror/view";
import type { PreviewSpan } from "remotion-md";

export interface PixelBand {
  topOffset: number;
  height: number;
}

/**
 * Delegate interface for ScrollManager to communicate viewport, bands, and positions
 */
export interface ScrollDelegate {
  onReflow(iframeHeight: number, bands: PixelBand[]): void;
  onScroll(scrollTop: number, positions: PixelBand[]): void;
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
  private resizeObserver: ResizeObserver | null = null;
  private currentSpans: PreviewSpan[] = [];
  private currentBands: PixelBand[] = [];
  private currentPlayerHeights: number[] = [];
  private scrollListener: (() => void) | null = null;

  constructor(
    private scrollDOM: HTMLElement,
    private container: HTMLElement,
    private editorView: EditorView,
    private delegate: ScrollDelegate,
  ) {
    console.log(this.scrollDOM);
    this.setupScrollListener();
    this.setupResizeObserver();
  }

  get scrollTop(): number {
    return this.scrollDOM.scrollTop;
  }

  get scrollHeight(): number {
    return this.scrollDOM.scrollHeight + this.getScrollOffset();
  }

  /**
   * Update the pixel bands based on new semantic spans from preview
   * @param spans
   */
  handlePreviewSpans(spans: PreviewSpan[]): void {
    this.currentSpans = spans;
    this.handleReflow();
  }

  /**
   * Recalculate bands and notify delegate of reflow event
   */
  private handleReflow(): void {
    console.log(`[Scroll] Editor reflow: iframeHeight=${this.scrollHeight}`);

    this.currentBands = this.convertToBands(this.currentSpans);

    this.delegate.onReflow(this.scrollHeight, this.currentBands);
    this.handleScroll();
  }

  /**
   * Replay stored spans (e.g., after players-rendered event)
   */
  handlePlayerHeights(playerHeights: number[]): void {
    this.currentPlayerHeights = playerHeights;

    this.handleScroll();
  }

  /**
   * Notify delegate of scroll position and player positions
   */
  private handleScroll(): void {
    this.delegate.onScroll(
      this.scrollTop,
      this.calculatePlayerPositions(
        this.currentBands,
        this.currentPlayerHeights,
      ),
    );
  }

  /**
   * Set up scroll event listener to notify viewport changes
   */
  private setupScrollListener(): void {
    this.scrollListener = () => {
      this.handleScroll();
    };
    this.handleScroll();
    this.scrollDOM.addEventListener("scroll", this.scrollListener);
  }

  /**
   * Set up resize observer to notify viewport changes on window reflow
   */
  private setupResizeObserver(): void {
    if (typeof ResizeObserver === "undefined") return;

    this.resizeObserver = new ResizeObserver(() => {
      this.handleReflow();
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
   * Convert semantic spans to pixel bands using viewport state
   * Uses span.pos and span.length to calculate full span height
   */
  private convertToBands(spans: PreviewSpan[]): PixelBand[] {
    const scrollOffset = this.getScrollOffset();

    return spans.map((span) => {
      const startCoords = this.editorView.coordsAtPos(span.pos);
      const endCoords = this.editorView.coordsAtPos(
        span.pos + (span.length || 0),
      );

      if (!startCoords || !endCoords) {
        console.error("[Scroll] Failed to get coords for span:", span);
        return { topOffset: 0, height: 0 };
      }

      const height = endCoords.bottom - startCoords.top;
      const topOffset = startCoords.top + scrollOffset;

      return { topOffset, height };
    });
  }

  /**
   * Calculate player positions with collision detection
   */
  private calculatePlayerPositions(
    bands: PixelBand[],
    playerHeights: number[],
  ): PixelBand[] {
    const defaultHeight = 400;
    const viewportCenter = this.container.clientHeight / 2;

    // Find the middle span closest to the viewport center
    let middleIndex = 0;
    if (bands.length > 0) {
      let closestDistance = Number.POSITIVE_INFINITY;
      for (let i = 0; i < bands.length; i++) {
        const band = bands[i];
        const bandCenter = band.topOffset + band.height / 2;
        const distance = Math.abs(bandCenter - viewportCenter);
        if (distance < closestDistance) {
          closestDistance = distance;
          middleIndex = i;
        }
      }
    }

    const newPositions: PixelBand[] = [];

    // Push players upward from the middle span
    for (let i = Math.min(middleIndex, bands.length - 1); i >= 0; i--) {
      const band = bands[i];
      if (i === middleIndex) {
        newPositions.push({
          topOffset: band.topOffset,
          height: playerHeights[i] ?? defaultHeight,
        });
      } else {
        const previousBand = newPositions[newPositions.length - 1];
        const newOffset = previousBand.topOffset - (band.height + 16); // 16 is the margin
        newPositions.push({
          topOffset: newOffset,
          height: playerHeights[i] ?? defaultHeight,
        });
      }
    }

    // Push players downward from the middle span
    for (let i = middleIndex + 1; i < bands.length; i++) {
      const previousBand = newPositions[newPositions.length - 1];
      const newOffset = previousBand.topOffset + (previousBand.height + 16); // 16 is the margin
      newPositions.push({
        topOffset: newOffset,
        height: playerHeights[i] ?? defaultHeight,
      });
    }

    return newPositions;
  }
}
