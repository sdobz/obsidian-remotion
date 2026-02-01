/*
 * Represents a long document that has a scrollable viewport
 */
export interface Viewport {
  scrollHeight: number;
  top: number;
  bottom: number;
}

/**
 * A horizontal band across the document
 */
export interface Band {
  center: number;
  height: number;
}

/**
 * Every item in associated sequences is known to have nulls in the same positions
 */
export type NullArray<T> = Array<T | null>;

function bandTop(band: Band) {
  return band.center - band.height / 2;
}

/**
 * Maps span bands to preview bands by:
 * 1. Scaling band positions proportionally
 * 2. Resizing bands to previewHeights
 * 3. Preventing overlaps by pushing bands downward
 * 4. Ensuring bands stay within scroll bounds
 */
export function slipPreviews(
  spans: NullArray<Band>,
  spansScrollHeight: number,
  previewHeights: NullArray<number>,
) {
  // Create previews with new heights, keeping null positions
  const previews: NullArray<Band> = spans.map((band, i) => {
    if (band === null || previewHeights[i] === null) {
      return null;
    }
    return {
      center: band.center,
      height: previewHeights[i]!,
    };
  });

  let lastPreviewBottom = 0;
  for (let i = 0; i < previews.length; i++) {
    const band = previews[i];
    if (band === null) {
      continue;
    }

    const halfHeight = band.height / 2;

    if (band.center - halfHeight < 0) {
      // Push down to stay within top bound
      band.center = halfHeight;
    }

    if (band.center - halfHeight < lastPreviewBottom) {
      // Push down to avoid overlap
      band.center = lastPreviewBottom + halfHeight;
    }

    lastPreviewBottom = band.center + halfHeight;
  }

  const previewScrollHeight = Math.max(lastPreviewBottom, spansScrollHeight);

  return { previews, previewScrollHeight };
}

export interface Interpolator {
  aTop: number;
  aBot: number;
  bTop: number;
  bBot: number;
  interpolator: (
    fromStart: number,
    fromPos: number,
    fromEnd: number,
    toStart: number,
    toEnd: number,
  ) => number;
}

export function buildInterpolator(
  spans: NullArray<Band>,
  editorScrollHeight: number,
  previews: NullArray<Band>,
  previewScrollHeight: number,
): Interpolator {
  return {
    aTop: 0,
    aBot: 0,
    bTop: 0,
    bBot: 0,
    interpolator: () => 0,
  };
}

export function interpolateScroll(
  spans: NullArray<Band>,
  spansScrollHeight: number,
  previews: NullArray<Band>,
  previewScrollHeight: number,
  previousInterpolator: Interpolator | undefined,
  scrollTop: number,
  scrollSource: "editor" | "preview",
): number {
  return 0;
}
