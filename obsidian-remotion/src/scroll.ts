import type { EditorView } from "@codemirror/view";
import type { PreviewSpan } from "remotion-md";
import * as scrollMath from "./scrollMath";
import { toPixelBand } from "./editor";
import { hash } from "crypto";

export interface PixelBand {
  topOffset: number;
  height: number;
}

/**
 * Delegate interface for ScrollManager to communicate viewport, bands, and positions
 */
export interface ScrollDelegate {
  onReflow(
    previewHeight: number,
    bands: (PixelBand | null)[],
    playerScrollHeight: number,
    players: (PixelBand | null)[],
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
  private currentBands: (PixelBand | null)[] = [];
  private lastBandHash: bigint = scrollMath.hashBands([]);
  private currentPlayerPositions: (PixelBand | null)[] = [];
  private currentPlayerHeights: number[] = [];
  private scrollListener: (() => void) | null = null;
  private lastViewportBandSet = "";

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
    return this.scrollDOM.scrollHeight;
  }

  /**
   * Get the offset of scrollDOM from its container top
   * Used to apply padding to iframe bands container for visual alignment
   */
  getScrollDOMOffset(): number {
    const scrollRect = this.scrollDOM.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();
    return containerRect.top - scrollRect.top;
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
    this.currentBands = this.currentSpans.map((span) =>
      toPixelBand(span, this.editorView),
    );
    this.lastBandHash = scrollMath.hashBands(this.currentBands);

    this.performReflow();
    this.performScroll();
  }

  private handleScroll(): void {
    const nextBands = this.currentSpans.map((span) =>
      toPixelBand(span, this.editorView),
    );
    const nextBandHash = scrollMath.hashBands(nextBands);

    // Only reflow if bands have changed
    if (nextBandHash !== this.lastBandHash) {
      this.currentBands = nextBands;
      this.lastBandHash = nextBandHash;
      this.performReflow();
    }

    this.performScroll();
  }

  /**
   * Use existing state to perform reflow
   */
  private performReflow(): void {
    this.currentPlayerPositions = scrollMath.layoutPlayers(
      this.currentBands,
      this.currentPlayerHeights,
    );
    const playerScrollHeight = scrollMath.computePlayerScrollHeight(
      this.scrollHeight,
      this.currentBands,
      this.currentPlayerPositions,
    );

    this.delegate.onReflow(
      this.scrollHeight,
      this.currentBands,
      playerScrollHeight,
      this.currentPlayerPositions,
    );
    this.performScroll();
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
  private performScroll(): void {
    const activeWeight = scrollMath.findActiveWeight(
      this.currentBands,
      this.scrollTop,
      this.container.clientHeight,
    );
    const playerScrollTop = scrollMath.computePlayerScrollTop(
      activeWeight,
      this.currentBands,
      this.currentPlayerPositions,
      this.scrollTop,
    );

    this.delegate.onScroll(this.scrollTop, playerScrollTop);
  }
  /**
   * Set up scroll event listener to notify viewport changes
   */
  private setupScrollListener(): void {
    this.scrollListener = () => {
      this.handleScroll();
    };
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
}
