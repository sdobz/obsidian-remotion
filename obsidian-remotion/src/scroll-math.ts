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
  spanTop: number;
  spanBot: number;
  previewTop: number;
  previewBot: number;
}

export function buildInterpolator(
  spans: NullArray<Band>,
  editorScrollHeight: number,
  previews: NullArray<Band>,
  previewScrollHeight: number,
  scrollCenter: number,
  scrollSource: "editor" | "preview",
): Interpolator {
  const bandSource = (scrollSource === "editor" ? spans : previews).filter(
    (b) => b !== null,
  ) as Band[];
  const bandTarget = (scrollSource === "editor" ? previews : spans).filter(
    (b) => b !== null,
  ) as Band[];

  // Find bands surrounding scrollCenter
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

  const minTop = minimumBounds(bandSource[topIndex], bandTarget[topIndex], 0);
  const minBot = minimumBounds(
    bandSource[botIndex],
    bandTarget[botIndex],
    scrollSource === "editor" ? editorScrollHeight : previewScrollHeight,
  );

  if (scrollCenter > minTop.top && scrollCenter < minBot.top) {
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
