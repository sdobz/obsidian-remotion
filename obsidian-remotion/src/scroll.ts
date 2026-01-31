import type { EditorView } from "@codemirror/view";
import type { PreviewSpan } from "remotion-md";
import * as scrollMath from "./scrollMath";
import { toPixelBand } from "./editor";

export interface PixelBand {
  top: number;
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
  private applyingScroll = false; // Prevent feedback loops from player scroll
  private applyingScrollTimeout: number | null = null;
  // Separate scroll states for forward (editor->player) and reverse (player->editor) mappings
  private spanScrollState: scrollMath.ScrollState = { lastActiveIndex: null };
  private previewScrollState: scrollMath.ScrollState = {
    lastActiveIndex: null,
  };

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

  get scrollElement(): HTMLElement {
    return this.scrollDOM;
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
      toPixelBand(span, this.editorView, this.scrollTop),
    );
    this.lastBandHash = scrollMath.hashBands(this.currentBands);

    this.performReflow();
    this.performScroll();
  }

  private handleScroll(): void {
    const nextBands = this.currentSpans.map((span) =>
      toPixelBand(span, this.editorView, this.scrollTop),
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
    const layoutResult = scrollMath.layoutPlayers(
      this.currentBands,
      this.scrollHeight,
      this.currentPlayerHeights,
    );
    this.currentPlayerPositions = layoutResult.positions;
    const playerScrollHeight = layoutResult.height;

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
    const playerScrollTop = scrollMath.mapScroll(
      this.currentBands,
      this.scrollTop,
      this.container.clientHeight,
      this.currentPlayerPositions,
      this.container.clientHeight,
      this.spanScrollState,
    );

    this.delegate.onScroll(this.scrollTop, playerScrollTop);
  }

  /**
   * Handle scroll events from the iframe player container
   * Maps player scroll back to editor scroll using reverse algorithm
   * Debounced to prevent feedback loops when editor applies scroll to player
   */
  handlePlayerScroll(playerScrollTop: number): void {
    // Ignore scroll events if we just applied a scroll programmatically
    if (this.applyingScroll) {
      return;
    }

    const editorScrollTop = scrollMath.mapScroll(
      this.currentPlayerPositions,
      playerScrollTop,
      this.container.clientHeight,
      this.currentBands,
      this.container.clientHeight,
      this.previewScrollState,
    );

    this.applyEditorScroll(editorScrollTop);
  }

  /**
   * Apply a computed editor scroll position
   * Marks scroll as programmatic to prevent feedback loops
   */
  private applyEditorScroll(scrollTop: number): void {
    this.setApplyingScroll();
    this.scrollDOM.scrollTop = scrollTop;
  }

  /**
   * Mark that we're applying scroll programmatically to prevent feedback loops
   */
  private setApplyingScroll(): void {
    this.applyingScroll = true;
    if (this.applyingScrollTimeout !== null) {
      clearTimeout(this.applyingScrollTimeout);
    }
    this.applyingScrollTimeout = window.setTimeout(() => {
      this.applyingScroll = false;
      this.applyingScrollTimeout = null;
    }, 50); // 50ms window to ignore echo scroll events
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
