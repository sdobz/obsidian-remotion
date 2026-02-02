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
  sourceTop: number;
  sourceBot: number;
  targetTop: number;
  targetBot: number;
}

export function buildInterpolator(
  spans: NullArray<Band>,
  editorScrollHeight: number,
  previews: NullArray<Band>,
  previewScrollHeight: number,
  scrollCenter: number,
  scrollSource: "editor" | "preview",
): Interpolator {
  const boundedSpans = [
    { center: 0, height: 0 },
    ...spans,
    { center: editorScrollHeight, height: 0 },
  ];
  const boundedPreviews = [
    { center: 0, height: 0 },
    ...previews,
    { center: previewScrollHeight, height: 0 },
  ];
  const bandSource = (
    scrollSource === "editor" ? boundedSpans : boundedPreviews
  ).filter((b) => b !== null) as Band[];
  const bandTarget = (
    scrollSource === "editor" ? boundedPreviews : boundedSpans
  ).filter((b) => b !== null) as Band[];

  let topIndex = -1;
  let botIndex = -1;

  for (let i = 0; i < bandSource.length; i++) {
    if (bandSource[i].center <= scrollCenter) {
      topIndex = i;
    }
    if (bandSource[i].center >= scrollCenter) {
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

  // Bands:
  // Exact: Inside the min band

  // Ease
  // Lerp
}

function minimumBounds(
  a: Band | undefined,
  b: Band | undefined,
  fallback: number,
) {
  if (!a || !b) {
    return { top: fallback, bottom: fallback };
  }
  if (a.height < b.height) {
    return {
      top: a.center - a.height / 2,
      bottom: a.center + a.height / 2,
    };
  } else {
    return {
      top: b.center - b.height / 2,
      bottom: b.center + b.height / 2,
    };
  }
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
