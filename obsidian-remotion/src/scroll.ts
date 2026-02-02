import type { EditorView } from "@codemirror/view";
import type { PreviewSpan } from "remotion-md";
import type {
  Band,
  Interpolator,
  InterpolatorSpec,
  NullArray,
} from "./scroll-math";
import {
  buildInterpolator,
  hashBands,
  interpolatorFor,
  slipPreviews,
} from "./scroll-math";
import { toBand } from "./editor";

/**
 * Delegate interface for ScrollManager to communicate viewport, bands, and positions
 */
export interface ScrollDelegate {
  onReflow(
    previewHeight: number,
    bands: NullArray<Band>,
    playerScrollHeight: number,
    players: NullArray<Band>,
  ): void;
  onScroll(previewScrollTop: number, playerScrollTop: number): void;
}

// ============================================================================
// Scroll and Band Management
//
// Flow: SemanticSpans → Bands → PlayerPositions → Viewport
//
// All calculations depend on current editor scroll state. When scroll/height
// changes, positions are recalculated. We store semantic spans for replay.
// ============================================================================

const SCROLL_COMMAND_THRESHOLD = 0.5; // pixels - ignore tiny diffs
export class ScrollManager {
  private resizeObserver: ResizeObserver | null = null;
  private currentSpans: PreviewSpan[] = [];
  private currentSpanPositions: NullArray<Band> = [];
  private currentPreviewPositions: NullArray<Band> = [];
  private previewScrollHeight: number = 0;
  private currentPreviewHeights: NullArray<number> = [];
  private handleEditorScroll: (() => void) | null = null;
  private lastCommandedEditorScrollTop: number = 0; // Track preview scroll commands for echo suppression in handlePlayerScroll
  private lastBandHash = hashBands([]);
  private spanInterpolatorInfo:
    | {
        spec: InterpolatorSpec;
        interpolator: Interpolator;
      }
    | undefined;
  private previewInterpolatorInfo:
    | {
        spec: InterpolatorSpec;
        interpolator: Interpolator;
      }
    | undefined;

  constructor(
    private scrollDOM: HTMLElement,
    private editorView: EditorView,
    private delegate: ScrollDelegate,
  ) {
    this.setupScrollListener();
    this.setupResizeObserver();
  }

  get spanScrollTop(): number {
    return this.scrollDOM.scrollTop;
  }

  get spanScrollHeight(): number {
    return this.scrollDOM.scrollHeight;
  }

  get viewportHeight(): number {
    return this.scrollDOM.clientHeight;
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
    this.spanInterpolatorInfo = undefined;
    this.previewInterpolatorInfo = undefined;
    this.currentSpanPositions = this.currentSpans.map((span) =>
      toBand(span, this.editorView, this.spanScrollTop),
    );

    this.performReflow();
    this.performSpanScroll();
  }

  private handleScroll(): void {
    const nextBands = this.currentSpans.map((span) =>
      toBand(span, this.editorView, this.spanScrollTop),
    );
    const nextBandHash = hashBands(nextBands);

    // Only reflow if bands have changed
    if (nextBandHash !== this.lastBandHash) {
      this.currentSpanPositions = nextBands;
      this.lastBandHash = nextBandHash;
      this.performReflow();
    }

    this.performSpanScroll();
  }

  /**
   * Use existing state to perform reflow
   */
  private performReflow(): void {
    const result = slipPreviews(
      this.currentSpanPositions,
      this.spanScrollHeight,
      this.currentPreviewHeights,
      this.viewportHeight,
    );
    this.currentPreviewPositions = result.previews;
    this.previewScrollHeight = result.previewScrollHeight;

    this.delegate.onReflow(
      this.spanScrollHeight,
      this.currentSpanPositions,
      this.previewScrollHeight,
      this.currentPreviewPositions,
    );
    this.performSpanScroll();
  }

  /**
   * Replay stored spans (e.g., after players-rendered event)
   */
  handlePlayerHeights(playerHeights: number[]): void {
    this.currentPreviewHeights = playerHeights;

    this.handleReflow();
  }

  /**
   * Notify delegate of scroll position and player positions
   */
  private performSpanScroll(): void {
    const scrollCenter = this.spanScrollTop + this.viewportHeight / 2;
    const interpolatorSpec =
      this.spanInterpolatorInfo &&
      this.spanInterpolatorInfo.spec.sourceTop <= scrollCenter &&
      scrollCenter <= this.spanInterpolatorInfo.spec.sourceBot
        ? this.spanInterpolatorInfo.spec
        : buildInterpolator(
            this.currentSpanPositions,
            this.spanScrollHeight,
            this.currentPreviewPositions,
            this.previewScrollHeight,
            scrollCenter,
            "span",
          );
    if (this.spanInterpolatorInfo?.spec !== interpolatorSpec) {
      this.spanInterpolatorInfo = {
        spec: interpolatorSpec,
        interpolator: interpolatorFor(interpolatorSpec),
      };
    }

    const mappedPlayerScrollTop =
      this.spanInterpolatorInfo.interpolator(
        this.spanScrollTop + this.viewportHeight / 2,
      ) -
      this.viewportHeight / 2;

    this.delegate.onScroll(this.spanScrollTop, mappedPlayerScrollTop);
  }

  /**
   * Handle scroll events from the iframe player container
   * Maps player scroll back to editor scroll using reverse algorithm
   */
  handlePlayerScroll(playerScrollTop: number): void {
    // Ignore scroll events that match what we just commanded the preview to do
    // (echo from our own scroll command that wasn't suppressed on iframe side)

    const scrollCenter = playerScrollTop + this.viewportHeight / 2;
    const interpolatorSpec =
      this.previewInterpolatorInfo &&
      this.previewInterpolatorInfo.spec.sourceTop <= scrollCenter &&
      scrollCenter <= this.previewInterpolatorInfo.spec.sourceBot
        ? this.previewInterpolatorInfo.spec
        : buildInterpolator(
            this.currentPreviewPositions,
            this.previewScrollHeight,
            this.currentSpanPositions,
            this.spanScrollHeight,
            scrollCenter,
            "preview",
          );
    if (this.previewInterpolatorInfo?.spec !== interpolatorSpec) {
      this.previewInterpolatorInfo = {
        spec: interpolatorSpec,
        interpolator: interpolatorFor(interpolatorSpec),
      };
    }

    const mappedEditorScrollTop =
      this.previewInterpolatorInfo.interpolator(
        playerScrollTop + this.viewportHeight / 2,
      ) -
      this.viewportHeight / 2;

    this.lastCommandedEditorScrollTop = mappedEditorScrollTop;
    this.scrollDOM.scrollTop = mappedEditorScrollTop;
  }

  /**
   * Set up scroll event listener to notify viewport changes
   */
  private setupScrollListener(): void {
    this.handleEditorScroll = () => {
      const editorScrollTop = this.scrollDOM.scrollTop;
      if (
        Math.abs(editorScrollTop - this.lastCommandedEditorScrollTop) <
        SCROLL_COMMAND_THRESHOLD
      ) {
        return; // This is the echo of our own scroll command
      }
      this.handleScroll();
    };
    this.scrollDOM.addEventListener("scroll", this.handleEditorScroll);
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
    if (this.handleEditorScroll) {
      this.scrollDOM.removeEventListener("scroll", this.handleEditorScroll);
      this.handleEditorScroll = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }
}
