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

/**
 *
 * @param source
 * @param sourceHeight
 * @param targetHeights
 * @returns
 */
export function slipPreviews(
  spans: NullArray<Band>,
  spansScrollHeight: number,
  previewHeights: NullArray<number>,
) {
  return { previews: spans, previewScrollHeight: spansScrollHeight };
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
): Interpolator {}

export function interpolateScroll(
  spans: NullArray<Band>,
  spansScrollHeight: number,
  previews: NullArray<Band>,
  previewScrollHeight: number,
  previousInterpolator: Interpolator | undefined,
  scrollTop: number,
  scrollSource: "editor" | "preview",
): number {}
