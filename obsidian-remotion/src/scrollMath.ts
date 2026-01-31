/**
 * Pure scroll synchronization math
 *
 * Handles layout and scroll mapping between editor bands and preview players.
 * All functions are pure - no side effects, no DOM access.
 */

import type { PixelBand } from "./scroll";

/**
 * Scroll state for hysteresis tracking
 */
export interface ScrollState {
  lastActiveIndex: number | null;
}

/**
 * Helper: calculate center of a band
 */
function center(b: PixelBand): number {
  return b.top + b.height / 2;
}

interface BandList {
  positions: (PixelBand | null)[];
  height: number;
}

/**
 * fitList implementation from scroll-algo
 * Preserve relative distances while enforcing non-overlap
 */
function fitList(
  source: (PixelBand | null)[],
  sourceHeight: number,
  targetHeights: Array<number | null>,
): BandList {
  const fit: (PixelBand | null)[] = new Array(source.length).fill(null);

  // Step 1: compute ideal tops based on source centers
  const ideals: Array<{ index: number; top: number; height: number }> = [];

  for (let i = 0; i < source.length; i++) {
    const src = source[i];
    const h = targetHeights[i];
    if (!src || h == null) continue;

    ideals.push({
      index: i,
      top: center(src) - h / 2,
      height: h,
    });
  }

  // Step 2: enforce minimum separation (single forward pass)
  let cursor = -Infinity;
  for (const item of ideals) {
    const top = Math.max(item.top, cursor);
    fit[item.index] = { top, height: item.height };
    cursor = top + item.height + 16; // minGap
  }

  const height = sourceHeight; // No scaling for now

  return { positions: fit, height };
}

/**
 * mapScroll: Anchor-based scroll mapping with hysteresis
 * Maps scroll position between two band arrays using center-alignment
 * with hysteresis to prevent jitter when scrolling between regions
 */
export function mapScroll(
  sourceBands: (PixelBand | null)[],
  sourceScrollTop: number,
  sourceViewportHeight: number,
  targetBands: (PixelBand | null)[],
  targetViewportHeight: number,
  state: ScrollState,
): number {
  const viewportCenter = sourceScrollTop + sourceViewportHeight / 2;

  // Find closest band to center
  let bestIndex: number | null = null;
  let bestDist = Infinity;

  for (let i = 0; i < sourceBands.length; i++) {
    const b = sourceBands[i];
    if (!b) continue;
    const d = Math.abs(center(b) - viewportCenter);
    if (d < bestDist) {
      bestDist = d;
      bestIndex = i;
    }
  }

  if (bestIndex == null) return 0;

  // Hysteresis: keep previous active if still close
  if (state.lastActiveIndex != null) {
    const prev = sourceBands[state.lastActiveIndex];
    if (prev) {
      const dPrev = Math.abs(center(prev) - viewportCenter);
      if (dPrev < bestDist * 1.2) {
        bestIndex = state.lastActiveIndex;
      }
    }
  }

  state.lastActiveIndex = bestIndex;

  const src = sourceBands[bestIndex];
  const tgt = targetBands[bestIndex];
  if (!src || !tgt) return 0;

  // Exact center alignment
  return center(tgt) - targetViewportHeight / 2;
}

/**
 * Calculate player positions and resulting scroll height
 * Returns both positioned players and the total height of player content
 */
export function layoutPlayers(
  bands: (PixelBand | null)[],
  bandsViewportHeight: number,
  playerHeights: number[],
): BandList {
  const heights = bands.map((band, i) =>
    band ? (playerHeights[i] ?? 400) : null,
  );

  return fitList(bands, bandsViewportHeight, heights);
}

export const hashBands = (arr: (PixelBand | null)[]): bigint => {
  let mask = BigInt(0);
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] !== null) {
      mask |= BigInt(1) << BigInt(i);
    }
  }
  return mask;
};
