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

const DEFAULT_PREVIEW_HEIGHT = 100;
export function slipPreviews(
  spans: NullArray<Band>,
  spansScrollHeight: number,
  previewHeights: NullArray<number>,
  viewportHeight: number,
) {
  // Create previews with new heights, keeping null positions
  const previews: NullArray<Band> = spans.map((band, i) => {
    if (band === null || previewHeights[i] === null) {
      return null;
    }
    return {
      center: band.center,
      height: previewHeights[i] ?? DEFAULT_PREVIEW_HEIGHT,
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

  let previewScrollHeight;
  const nonNullSpans = spans.filter((b): b is Band => b !== null);
  if (nonNullSpans.length === 0) {
    previewScrollHeight = spansScrollHeight;
  } else {
    const nonNullPreviews = previews.filter((b): b is Band => b !== null);

    const lastSpan = nonNullSpans[nonNullSpans.length - 1];
    const lastPreview = nonNullPreviews[nonNullPreviews.length - 1];

    const smallerHalfHeight = Math.min(
      lastSpan.height / 2,
      lastPreview.height / 2,
    );

    const spanGapToBottom =
      spansScrollHeight - (lastSpan.center + smallerHalfHeight);
    previewScrollHeight =
      lastPreview.center + smallerHalfHeight + spanGapToBottom;
  }

  return { previews, previewScrollHeight };
}

export interface InterpolatorSpec {
  leftTop: number;
  leftBot: number;
  rightTop: number;
  rightBot: number;
}

export type Interpolator = (leftScrollTop: number) => number;

/**
 * Build all interpolator specs for the entire document
 * Returns an array covering all possible scroll positions
 */
export function buildInterpolators(
  nullableLeft: NullArray<Band>,
  leftHeight: number,
  nullableRight: NullArray<Band>,
  rightHeight: number,
): InterpolatorSpec[] {
  const leftBands = [
    { center: 0, height: 0 },
    ...(nullableLeft.filter((b) => b !== null) as Band[]),
    { center: leftHeight, height: 0 },
  ];
  const rightBands = [
    { center: 0, height: 0 },
    ...(nullableRight.filter((b) => b !== null) as Band[]),
    { center: rightHeight, height: 0 },
  ];

  const regions: InterpolatorSpec[] = [];

  for (let i = 0; i < leftBands.length; i++) {
    const leftBand = leftBands[i];
    const rightBand = rightBands[i];
    const smallerBand =
      leftBand.height < rightBand.height ? leftBand : rightBand;
    const halfSmaller = smallerBand.height / 2;

    // Region 1: Exact region within the band (tight coupling)
    const exactTop = leftBand.center - halfSmaller;
    const exactBot = leftBand.center + halfSmaller;

    if (i > 0 && i < leftBands.length - 1) {
      // Boundary regions have zero height
      regions.push({
        leftTop: exactTop,
        leftBot: exactBot,
        rightTop: rightBand.center - halfSmaller,
        rightBot: rightBand.center + halfSmaller,
      });
    }

    // Region 2: Blend region to next band (if not last)
    if (i < leftBands.length - 1) {
      const nextLeftBand = leftBands[i + 1];
      const nextRightBand = rightBands[i + 1];
      const nextSmaller =
        nextLeftBand.height < nextRightBand.height
          ? nextLeftBand
          : nextRightBand;
      const halfNextSmaller = nextSmaller.height / 2;

      const blendTop = exactBot;
      const blendBot = nextLeftBand.center - halfNextSmaller;

      // Only create blend region if there's space between bands
      if (blendBot > blendTop) {
        regions.push({
          leftTop: blendTop,
          leftBot: blendBot,
          rightTop: rightBand.center + halfSmaller,
          rightBot: nextRightBand.center - halfNextSmaller,
        });
      }
    }
  }

  return regions;
}

/**
 * Find the appropriate interpolator spec for a given scroll position
 */
export function findInterpolatorRegion(
  regions: InterpolatorSpec[],
  sourceScrollCenter: number,
  source: "left" | "right",
): InterpolatorSpec {
  const top = source === "left" ? "leftTop" : "rightTop";
  const bot = source === "left" ? "leftBot" : "rightBot";

  // Linear search is fine for ~10 bands (11 regions)
  for (const spec of regions) {
    if (sourceScrollCenter >= spec[top] && sourceScrollCenter <= spec[bot]) {
      return spec;
    }
  }

  // Fallback: use closest region (shouldn't happen but be defensive)
  if (regions.length === 0) {
    return { leftTop: 0, leftBot: 0, rightTop: 0, rightBot: 0 };
  }

  if (sourceScrollCenter < regions[0][top]) {
    return regions[0];
  }

  return regions[regions.length - 1];
}

export function interpolatorFor(
  interpolator: InterpolatorSpec,
  target: "left" | "right",
): (sourceScrollTop: number) => number {
  const sourceBot =
    target === "left" ? interpolator.rightBot : interpolator.leftBot;
  const sourceTop =
    target === "left" ? interpolator.rightTop : interpolator.leftTop;
  const targetTop =
    target === "left" ? interpolator.leftTop : interpolator.rightTop;
  const targetBot =
    target === "left" ? interpolator.leftBot : interpolator.rightBot;

  const sourceRange = sourceBot - sourceTop;
  const targetRange = targetBot - targetTop;

  if (sourceRange === 0) {
    // Avoid division by zero; stay at right top
    return (_sourceScrollTop: number) => interpolator.rightTop;
  }
  return (sourceScrollTop: number) => {
    const ratio = (sourceScrollTop - sourceTop) / sourceRange;
    return targetTop + ratio * targetRange;
  };
}

export const hashBands = (arr: (Band | null)[]): bigint => {
  let mask = BigInt(0);
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] !== null) {
      mask |= BigInt(1) << BigInt(i);
    }
  }
  return mask;
};
