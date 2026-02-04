/**
 * Scroll synchronization module
 * Handles scroll events, echo suppression, and bidirectional scroll mapping
 */

import type { InterpolatorSpec } from "../editor/scroll-math";
import { findInterpolatorRegion, interpolatorFor } from "../editor/scroll-math";

const SCROLL_COMMAND_THRESHOLD = 0.5;

export class ScrollCoordinator {
  private bandScrollTop = 0;
  private playerScrollTop = 0;
  private interpolatorSpecs: InterpolatorSpec[] = [];
  private syncEnabled = false;

  constructor(
    private DOM: { bandScroller: HTMLElement; playerScroller: HTMLElement },
    private onPlayerScroll: (playerScrollTop: number) => void,
    private renderLinks: () => void,
  ) {
    this.DOM.playerScroller.addEventListener("scroll", () => {
      if (!this.syncEnabled) return;
      if (
        Math.abs(this.DOM.playerScroller.scrollTop - this.playerScrollTop) <
        SCROLL_COMMAND_THRESHOLD
      ) {
        return;
      }
      this.playerScrollTop = this.DOM.playerScroller.scrollTop;

      const viewportHeight = this.DOM.playerScroller.clientHeight;
      const scrollCenter =
        this.DOM.playerScroller.scrollTop + viewportHeight / 2;
      const interpolator = findInterpolatorRegion(
        this.interpolatorSpecs,
        scrollCenter,
        "right",
      );
      this.bandScrollTop =
        interpolatorFor(interpolator, "left")(scrollCenter) -
        viewportHeight / 2;
      this.DOM.bandScroller.scrollTop = this.bandScrollTop;

      this.renderLinks();
      this.onPlayerScroll(this.DOM.playerScroller.scrollTop);
    });
  }

  scrollTo(editorScrollTop: number): void {
    this.syncEnabled = true;
    this.DOM.bandScroller.scrollTop = editorScrollTop;
    this.bandScrollTop = editorScrollTop;

    const viewportHeight = this.DOM.playerScroller.clientHeight;
    const scrollCenter = editorScrollTop + viewportHeight / 2;
    const interpolatorSpec = findInterpolatorRegion(
      this.interpolatorSpecs,
      scrollCenter,
      "left",
    );
    const interpolator = interpolatorFor(interpolatorSpec, "right");
    this.playerScrollTop = interpolator(scrollCenter) - viewportHeight / 2;
    this.DOM.playerScroller.scrollTop = this.playerScrollTop;

    this.renderLinks();
  }

  updateInterpolators(specs: InterpolatorSpec[]): void {
    this.interpolatorSpecs = specs;
    if (specs.length > 0) {
      this.syncEnabled = true;
    }
  }

  get scrollPositions(): { bandScrollTop: number; playerScrollTop: number } {
    return {
      bandScrollTop: this.bandScrollTop,
      playerScrollTop: this.playerScrollTop,
    };
  }

  reset(): void {
    this.bandScrollTop = 0;
    this.playerScrollTop = 0;
    this.interpolatorSpecs = [];
    this.syncEnabled = false;
    this.DOM.bandScroller.scrollTop = 0;
    this.DOM.playerScroller.scrollTop = 0;
  }
}
