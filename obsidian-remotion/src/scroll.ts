import type { EditorView } from "@codemirror/view";
import type { PreviewSpan } from "remotion-md";

export interface PixelBand {
  topOffset: number;
  outOfViewport?: boolean;
  height: number;
}

/**
 * Metadata for tracking approximations in bands
 */
interface BandMetadata {
  topOffsetApproximated: boolean;
  heightApproximated: boolean;
  spanStart: number;
  spanEnd: number;
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
  private bandMetadata: BandMetadata[] = [];
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
    // Try to resolve any remaining approximations
    this.resolveApproximations();

    const activeWeight = this.findActiveWeight(this.currentBands);
    console.log(`[Scroll] Active weight: ${activeWeight}`);
    const playerScrollTop = this.computePlayerScrollTop(activeWeight);

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
   * Attempts to get real coordinates, falls back to approximations if outside viewport
   * Tracks which values are approximated so they can be resolved later
   */
  private convertToBands(spans: PreviewSpan[]): PixelBand[] {
    const scrollOffset = this.getScrollOffset();
    this.bandMetadata = [];

    return spans.map((span, index) => {
      const spanStart = span.pos ?? 0;
      const spanEnd = spanStart + (span.length || 0);

      const startCoords = this.editorView.coordsAtPos(spanStart);
      const endCoords = this.editorView.coordsAtPos(spanEnd);

      // Try to get actual coordinates
      if (startCoords && endCoords) {
        const height = endCoords.bottom - startCoords.top;
        const topOffset = startCoords.top + scrollOffset;

        this.bandMetadata.push({
          topOffsetApproximated: false,
          heightApproximated: false,
          spanStart,
          spanEnd,
        });

        return { topOffset, height };
      }

      // Approximation: use line-based estimates from compiler
      const approximation = this.approximateBandFromSpan(span, scrollOffset);
      this.bandMetadata.push({
        topOffsetApproximated: true,
        heightApproximated: true,
        spanStart,
        spanEnd,
      });

      return approximation;
    });
  }

  /**
   * Estimate band position and height based on document structure
   * Uses span length to estimate lines, avoiding viewport-dependent lineAt
   */
  private approximateBandFromSpan(
    span: PreviewSpan,
    scrollOffset: number,
  ): PixelBand {
    // Use compiler's accurate line number (1-based) instead of character position
    const lineNumber = span.line; // 1-based from compiler
    const averageLineHeight = this.estimateAverageLineHeight();

    // Position at the start of the line
    const estimatedTopOffset =
      (lineNumber - 1) * averageLineHeight + scrollOffset;

    // Count newlines directly to determine line count (more efficient than split)
    let numLines = 1;
    if (span.text) {
      for (let i = 0; i < span.text.length; i++) {
        if (span.text[i] === "\n") numLines++;
      }
    }
    const estimatedHeight = numLines * averageLineHeight;

    console.log(
      `[Scroll] Approximated band (line ${lineNumber}, ~${numLines} lines): height=${estimatedHeight}`,
    );

    return {
      topOffset: estimatedTopOffset,
      height: estimatedHeight,
    };
  }

  /**
   * Estimate average line height from visible lines
   */
  private estimateAverageLineHeight(): number {
    try {
      // Try to measure a visible line
      const line = this.editorView.state.doc.line(1);
      const coords = this.editorView.coordsAtPos(line.from);
      if (coords) {
        // Get height of first line
        const nextLineCoords = this.editorView.coordsAtPos(
          Math.min(line.to + 1, this.editorView.state.doc.length),
        );
        if (nextLineCoords) {
          return Math.max(16, nextLineCoords.top - coords.top);
        }
      }
    } catch (e) {
      // Silently fall back to default
    }
    return 20; // Default estimate
  }

  /**
   * Try to resolve any remaining approximations by re-polling coordsAtPos
   */
  private resolveApproximations(): void {
    let anyResolved = false;
    const scrollOffset = this.getScrollOffset();

    for (let i = 0; i < this.bandMetadata.length; i++) {
      const metadata = this.bandMetadata[i];
      const band = this.currentBands[i];

      if (!metadata || !band) continue;

      // Try to resolve topOffset
      if (metadata.topOffsetApproximated) {
        const coords = this.editorView.coordsAtPos(metadata.spanStart);
        if (coords) {
          band.topOffset = coords.top + scrollOffset;
          metadata.topOffsetApproximated = false;
          anyResolved = true;
        }
      }

      // Try to resolve height
      if (metadata.heightApproximated) {
        const startCoords = this.editorView.coordsAtPos(metadata.spanStart);
        const endCoords = this.editorView.coordsAtPos(metadata.spanEnd);
        if (startCoords && endCoords) {
          band.height = endCoords.bottom - startCoords.top;
          metadata.heightApproximated = false;
          anyResolved = true;
        }
      }
    }

    if (anyResolved) {
      console.log("[Scroll] Resolved some band approximations");
      // Recalculate player positions with updated bands
      this.currentPlayerPositions = this.calculatePlayerPositions(
        this.currentBands,
        this.currentPlayerHeights,
      );
    }
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
   * Find the active weight - a float index representing position between bands
   * Returns index + fraction (e.g., 1.3 = 30% between band 1 and band 2)
   * Only blends if bands are within viewport height, otherwise snaps to nearest
   */
  private findActiveWeight(bands: PixelBand[]): number {
    if (bands.length === 0) return 0;
    if (bands.length === 1) return 0;

    const viewportCenter = this.scrollTop + this.container.clientHeight / 2;

    // Find which two sequential bands the viewport center is between
    for (let i = 0; i < bands.length - 1; i++) {
      const band1 = bands[i];
      const band2 = bands[i + 1];

      const center1 = band1.topOffset + band1.height / 2;
      const center2 = band2.topOffset + band2.height / 2;

      // Check if viewport center is between these two band centers
      if (viewportCenter >= center1 && viewportCenter <= center2) {
        // Calculate fraction between the two bands
        const totalDistance = center2 - center1;
        const distanceFromFirst = viewportCenter - center1;
        const fraction =
          totalDistance > 0 ? distanceFromFirst / totalDistance : 0;
        return i + fraction;
      }
    }

    // Viewport center is outside all bands - snap to nearest
    const firstCenter = bands[0].topOffset + bands[0].height / 2;
    if (viewportCenter < firstCenter) {
      return 0;
    }

    const lastCenter =
      bands[bands.length - 1].topOffset + bands[bands.length - 1].height / 2;
    if (viewportCenter > lastCenter) {
      return bands.length - 1;
    }

    // Fallback: find nearest band
    let nearest = 0;
    let minDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < bands.length; i++) {
      const center = bands[i].topOffset + bands[i].height / 2;
      const distance = Math.abs(center - viewportCenter);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = i;
      }
    }
    return nearest;
  }

  /**
   * Compute player scroll position using matching algorithm with smooth blending:
   * 1. Use activeWeight (can be fractional) to identify active span(s)
   * 2. Blend between adjacent players if activeWeight is fractional
   * 3. Align blended player center with corresponding blended band center on screen
   */
  private computePlayerScrollTop(activeWeight: number): number {
    if (
      this.currentBands.length === 0 ||
      this.currentPlayerPositions.length === 0
    ) {
      return 0;
    }

    const index1 = Math.floor(activeWeight);
    const index2 = Math.min(index1 + 1, this.currentBands.length - 1);
    const fraction = activeWeight - index1;

    const band1 = this.currentBands[index1];
    const player1 = this.currentPlayerPositions[index1];

    if (fraction === 0 || index1 === index2) {
      // No blending needed, use exact position
      const bandCenter = band1.topOffset + band1.height / 2;
      const playerCenter = player1.topOffset + player1.height / 2;
      const centerOffset = playerCenter - bandCenter;
      return Math.max(0, this.scrollTop + centerOffset);
    }

    // Blend between two adjacent bands/players
    const band2 = this.currentBands[index2];
    const player2 = this.currentPlayerPositions[index2];

    const bandCenter1 = band1.topOffset + band1.height / 2;
    const bandCenter2 = band2.topOffset + band2.height / 2;
    const blendedBandCenter =
      bandCenter1 * (1 - fraction) + bandCenter2 * fraction;

    const playerCenter1 = player1.topOffset + player1.height / 2;
    const playerCenter2 = player2.topOffset + player2.height / 2;
    const blendedPlayerCenter =
      playerCenter1 * (1 - fraction) + playerCenter2 * fraction;

    const centerOffset = blendedPlayerCenter - blendedBandCenter;
    return Math.max(0, this.scrollTop + centerOffset);
  }
}
