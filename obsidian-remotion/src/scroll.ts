import type { EditorView } from "@codemirror/view";
import type { PreviewSpan } from "remotion-md";

export interface PixelBand {
  topOffset: number;
  outOfViewport?: boolean;
  height: number;
}

/**
 * Delegate interface for ScrollManager to communicate viewport, bands, and positions
 */
export interface ScrollDelegate {
  onReflow(
    previewHeight: number,
    bands: PixelBand[],
    playerScrollHeight: number,
    players: PixelBand[],
  ): void;
  onScroll(previewScrollTop: number, playerScrollTop: number): void;
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
  private currentPlayerPositions: PixelBand[] = [];
  private currentPlayerHeights: number[] = [];
  private scrollListener: (() => void) | null = null;

  constructor(
    private scrollDOM: HTMLElement,
    private container: HTMLElement,
    private editorView: EditorView,
    private delegate: ScrollDelegate,
  ) {
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
    console.log(`[Scroll] Editor reflow: previewHeight=${this.scrollHeight}`);

    this.currentBands = this.convertToBands(this.currentSpans);
    this.currentPlayerPositions = this.calculatePlayerPositions(
      this.currentBands,
      this.currentPlayerHeights,
    );
    const playerScrollHeight = this.computePlayerScrollHeight(
      this.currentPlayerPositions,
    );

    this.delegate.onReflow(
      this.scrollHeight,
      this.currentBands,
      playerScrollHeight,
      this.currentPlayerPositions,
    );
    this.handleScroll();
  }

  /**
   * Replay stored spans (e.g., after players-rendered event)
   */
  handlePlayerHeights(playerHeights: number[]): void {
    this.currentPlayerHeights = playerHeights;

    this.handleReflow();
  }

  /**
   * Notify delegate of scroll position and player positions
   */
  private handleScroll(): void {
    const activePlayerIndex = this.findActivePlayerIndex(this.currentBands);
    const playerScrollTop = this.computePlayerScrollTop(activePlayerIndex);

    this.delegate.onScroll(this.scrollTop, playerScrollTop);
  }

  /**
   * Set up scroll event listener to notify viewport changes
   */
  private setupScrollListener(): void {
    this.scrollListener = () => {
      if (this.currentBands.some((band) => band.outOfViewport)) {
        this.handleReflow();
      } else {
        this.handleScroll();
      }
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
   *
   * If a span is outside the viewport, coordsAtPos() returns null.
   * In this case, we position it at the bottom and it will be updated
   * once the user scrolls it into view.
   */
  private convertToBands(spans: PreviewSpan[]): PixelBand[] {
    const scrollOffset = this.getScrollOffset();

    return spans.map((span, index) => {
      const spanStart = span.pos ?? 0;
      const spanEnd = spanStart + (span.length || 0);

      const startCoords = this.editorView.coordsAtPos(spanStart);
      const endCoords = this.editorView.coordsAtPos(spanEnd);

      // If coords are null, span is outside viewport - position at bottom for now
      if (!startCoords || !endCoords) {
        console.log(
          `[Scroll] Span ${index} (pos=${spanStart}, len=${span.length}): off-viewport, positioning at bottom until scrolled into view`,
        );
        return {
          topOffset: this.scrollHeight + scrollOffset,
          outOfViewport: true,
          height: 400, // default player height
        };
      }

      const height = endCoords.bottom - startCoords.top;
      const topOffset = startCoords.top + scrollOffset;

      return { topOffset, height };
    });
  }

  /**
   * Calculate player positions by de-overlapping players
   * Start each player at its band position, then step down any that overlap
   */
  private calculatePlayerPositions(
    bands: PixelBand[],
    playerHeights: number[],
  ): PixelBand[] {
    const defaultHeight = 400;
    const margin = 16;
    let overlapOffset = 0;

    const positions: PixelBand[] = bands.map((band, i) => ({
      topOffset: band.topOffset,
      height: playerHeights[i] ?? defaultHeight,
    }));

    // Check each player for overlap with previous and adjust if needed
    for (let i = 1; i < positions.length; i++) {
      const prev = positions[i - 1];
      const curr = positions[i];

      const prevBottom = prev.topOffset + prev.height + margin;
      const overlap = prevBottom - curr.topOffset;

      if (overlap > 0) {
        // Add overlap to offset
        overlapOffset += overlap;

        // Step this and all following players down by the accumulated offset
        for (let j = i; j < positions.length; j++) {
          positions[j].topOffset += overlapOffset;
        }
      }
    }

    return positions;
  }

  /**
   * Compute player container height as bandScrollHeight + overlap offset
   * The overlap offset is computed during calculatePlayerPositions
   */
  private computePlayerScrollHeight(playerPositions: PixelBand[]): number {
    if (playerPositions.length === 0) return this.scrollHeight;

    // Find the total offset added to avoid overlaps
    // This is the difference between the last player's position and its band
    const lastPlayerIndex = playerPositions.length - 1;
    const lastBand = this.currentBands[lastPlayerIndex];
    const lastPlayer = playerPositions[lastPlayerIndex];

    if (!lastBand) return this.scrollHeight;

    const overlapOffset = lastPlayer.topOffset - lastBand.topOffset;
    return this.scrollHeight + overlapOffset;
  }

  /**
   * Find the active player index - the one closest to the viewport center
   */
  private findActivePlayerIndex(bands: PixelBand[]): number {
    const viewportCenter = this.scrollTop + this.container.clientHeight / 2;

    let activeIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < bands.length; i++) {
      const band = bands[i];
      const bandCenter = band.topOffset + band.height / 2;
      const distance = Math.abs(bandCenter - viewportCenter);
      if (distance < closestDistance) {
        closestDistance = distance;
        activeIndex = i;
      }
    }

    return activeIndex;
  }

  /**
   * Compute player scroll position using matching algorithm:
   * 1. Identify the active preview span (closest to viewport center)
   * 2. Scroll players such that the active player's center aligns with the active band's center on screen
   */
  private computePlayerScrollTop(activePlayerIndex: number): number {
    if (
      this.currentBands.length === 0 ||
      this.currentPlayerPositions.length === 0 ||
      activePlayerIndex >= this.currentBands.length
    ) {
      return 0;
    }

    const activeBand = this.currentBands[activePlayerIndex];
    const activePlayer = this.currentPlayerPositions[activePlayerIndex];

    // Calculate offset between player and band centers
    const bandCenter = activeBand.topOffset + activeBand.height / 2;
    const playerCenter = activePlayer.topOffset + activePlayer.height / 2;
    const centerOffset = playerCenter - bandCenter;

    // Player scroll top = preview scroll top + center offset
    // This aligns the player center with the band center on screen
    const playerScrollTop = Math.max(0, this.scrollTop + centerOffset);

    return playerScrollTop;
  }
}
