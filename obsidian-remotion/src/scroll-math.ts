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

export interface InterpolatorSpec {
  sourceTop: number;
  sourceBot: number;
  targetTop: number;
  targetBot: number;
}
export type Interpolator = (sourceScrollTop: number) => number;

export function buildInterpolator(
  spans: NullArray<Band>,
  spanScrollHeight: number,
  previews: NullArray<Band>,
  previewScrollHeight: number,
  scrollCenter: number,
  scrollSource: "span" | "preview",
): InterpolatorSpec {
  const boundedSpans = [
    { center: 0, height: 0 },
    ...spans,
    { center: spanScrollHeight, height: 0 },
  ];
  const boundedPreviews = [
    { center: 0, height: 0 },
    ...previews,
    { center: previewScrollHeight, height: 0 },
  ];
  const bandSource = (
    scrollSource === "span" ? boundedSpans : boundedPreviews
  ).filter((b) => b !== null) as Band[];
  const bandTarget = (
    scrollSource === "span" ? boundedPreviews : boundedSpans
  ).filter((b) => b !== null) as Band[];

  let topIndex = 0;
  let botIndex = bandSource.length - 1;

  for (let i = 0; i < bandSource.length; i++) {
    if (bandSource[i].center <= scrollCenter) {
      topIndex = i;
    }
    if (bandSource[i].center > scrollCenter) {
      botIndex = i;
      break;
    }
  }

  const bandMidLine =
    (bandSource[topIndex]!.center + bandSource[botIndex]!.center) / 2;

  const closestIndex = scrollCenter > bandMidLine ? botIndex : topIndex;
  const closestSourceBand = bandSource[closestIndex];
  const closestTargetBand = bandTarget[closestIndex];

  const scrollDistanceFromClosestBand = Math.abs(
    scrollCenter - bandSource[closestIndex]!.center,
  );

  const smallerBand =
    closestSourceBand.height < closestTargetBand.height
      ? closestSourceBand
      : closestTargetBand;

  const sourceTop = bandSource[topIndex];
  const sourceBot = bandSource[botIndex];
  const targetTop = bandTarget[topIndex];
  const targetBot = bandTarget[botIndex];

  if (scrollDistanceFromClosestBand <= smallerBand.height / 2) {
    return {
      sourceTop: closestSourceBand.center - smallerBand.height / 2,
      sourceBot: closestSourceBand.center + smallerBand.height / 2,
      targetTop: closestTargetBand.center - smallerBand.height / 2,
      targetBot: closestTargetBand.center + smallerBand.height / 2,
    };
  } else {
    const smallerTop =
      sourceTop.height < targetTop.height ? sourceTop : targetTop;
    const smallerBot =
      sourceBot.height < targetBot.height ? sourceBot : targetBot;
    return {
      sourceTop: sourceTop.center + smallerTop.height / 2,
      sourceBot: sourceBot.center - smallerBot.height / 2,
      targetTop: targetTop.center + smallerTop.height / 2,
      targetBot: targetBot.center - smallerBot.height / 2,
    };
  }
}

export function interpolatorFor(
  interpolator: InterpolatorSpec,
): (sourceScrollTop: number) => number {
  const sourceRange = interpolator.sourceBot - interpolator.sourceTop;
  const targetRange = interpolator.targetBot - interpolator.targetTop;

  if (sourceRange === 0) {
    // Avoid division by zero; stay at target top
    return (_sourceScrollTop: number) => interpolator.targetTop;
  }
  return (sourceScrollTop: number) => {
    const ratio = (sourceScrollTop - interpolator.sourceTop) / sourceRange;
    return interpolator.targetTop + ratio * targetRange;
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
