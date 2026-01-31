/**
 * Pure scroll synchronization math
 *
 * Handles layout and scroll mapping between editor bands and preview players.
 * All functions are pure - no side effects, no DOM access.
 */

import type { PixelBand } from "./scroll";

/**
 * Calculate player positions by de-overlapping players
 * Start each player at its band position, then step down any that overlap
 */
export function layoutPlayers(
  bands: (PixelBand | null)[],
  playerHeights: number[],
): (PixelBand | null)[] {
  const defaultHeight = 400;
  const margin = 16;
  let overlapOffset = 0;

  const positions: (PixelBand | null)[] = bands.map((band, i) =>
    band
      ? {
          topOffset: band.topOffset,
          height: playerHeights[i] ?? defaultHeight,
        }
      : null,
  );

  // Check each player for overlap with previous and adjust if needed
  for (let i = 1; i < positions.length; i++) {
    const prev = positions[i - 1];
    const curr = positions[i];

    if (!prev || !curr) continue; // Skip null entries

    const prevBottom = prev.topOffset + prev.height + margin;
    const overlap = prevBottom - curr.topOffset;

    if (overlap > 0) {
      // Add overlap to offset
      overlapOffset += overlap;

      // Step this and all following players down by the accumulated offset
      for (let j = i; j < positions.length; j++) {
        if (positions[j]) {
          (positions[j] as PixelBand).topOffset += overlapOffset;
        }
      }
    }
  }

  return positions;
}

/**
 * Compute player container height as bandScrollHeight + overlap offset
 * The overlap offset is computed during layoutPlayers
 */
export function computePlayerScrollHeight(
  bandScrollHeight: number,
  bands: (PixelBand | null)[],
  playerPositions: (PixelBand | null)[],
): number {
  if (playerPositions.length === 0 || bands.length === 0) {
    return bandScrollHeight;
  }

  // Find the total offset added to avoid overlaps
  // This is the difference between the last player's position and its band
  const lastPlayerIndex = playerPositions.length - 1;
  const lastBand = bands[lastPlayerIndex];
  const lastPlayer = playerPositions[lastPlayerIndex];

  if (!lastBand || !lastPlayer) return bandScrollHeight;

  const overlapOffset = lastPlayer.topOffset - lastBand.topOffset;
  return bandScrollHeight + overlapOffset;
}

/**
 * Find the active weight - a float index representing position between bands
 * Returns index + fraction (e.g., 1.3 = 30% between band 1 and band 2)
 * Only blends if bands are within viewport height, otherwise snaps to nearest
 */
export function findActiveWeight(
  bands: (PixelBand | null)[],
  scrollTop: number,
  viewportHeight: number,
): number {
  const activeBands = bands.filter((b): b is PixelBand => b !== null);
  if (activeBands.length === 0) return 0;
  if (activeBands.length === 1) return 0;

  const viewportCenter = scrollTop + viewportHeight / 2;

  // Find which two sequential bands the viewport center is between
  for (let i = 0; i < activeBands.length - 1; i++) {
    const band1 = activeBands[i];
    const band2 = activeBands[i + 1];

    const center1 = band1.topOffset + band1.height / 2;
    const center2 = band2.topOffset + band2.height / 2;

    // Check if viewport center is between these two band centers
    if (viewportCenter >= center1 && viewportCenter <= center2) {
      // Calculate fraction between the two bands
      const totalDistance = center2 - center1;
      const distanceFromFirst = viewportCenter - center1;
      const fraction =
        totalDistance > 0 ? distanceFromFirst / totalDistance : 0;
      return i + fraction;
    }
  }

  // Viewport center is outside all bands - snap to nearest
  const firstCenter = activeBands[0].topOffset + activeBands[0].height / 2;
  if (viewportCenter < firstCenter) {
    return 0;
  }

  const lastCenter =
    activeBands[activeBands.length - 1].topOffset +
    activeBands[activeBands.length - 1].height / 2;
  if (viewportCenter > lastCenter) {
    return activeBands.length - 1;
  }

  // Fallback: find nearest band
  let nearest = 0;
  let minDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < activeBands.length; i++) {
    const center = activeBands[i].topOffset + activeBands[i].height / 2;
    const distance = Math.abs(center - viewportCenter);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = i;
    }
  }
  return nearest;
}

/**
 * Compute player scroll position using matching algorithm with smooth blending:
 * 1. Use activeWeight (can be fractional) to identify active span(s)
 * 2. Blend between adjacent players if activeWeight is fractional
 * 3. Align blended player center with corresponding blended band center on screen
 */
export function computePlayerScrollTop(
  activeWeight: number,
  bands: (PixelBand | null)[],
  playerPositions: (PixelBand | null)[],
  scrollTop: number,
): number {
  const activeBands = bands.filter((b): b is PixelBand => b !== null);
  const activePositions = playerPositions.filter(
    (p): p is PixelBand => p !== null,
  );

  if (activeBands.length === 0 || activePositions.length === 0) {
    return 0;
  }

  const index1 = Math.floor(activeWeight);
  const index2 = Math.min(index1 + 1, activeBands.length - 1);
  const fraction = activeWeight - index1;

  const band1 = activeBands[index1];
  const player1 = activePositions[index1];

  if (fraction === 0 || index1 === index2) {
    // No blending needed, use exact position
    const bandCenter = band1.topOffset + band1.height / 2;
    const playerCenter = player1.topOffset + player1.height / 2;
    const centerOffset = playerCenter - bandCenter;
    return Math.max(0, scrollTop + centerOffset);
  }

  // Blend between two adjacent bands/players
  const band2 = activeBands[index2];
  const player2 = activePositions[index2];

  const bandCenter1 = band1.topOffset + band1.height / 2;
  const bandCenter2 = band2.topOffset + band2.height / 2;
  const blendedBandCenter =
    bandCenter1 * (1 - fraction) + bandCenter2 * fraction;

  const playerCenter1 = player1.topOffset + player1.height / 2;
  const playerCenter2 = player2.topOffset + player2.height / 2;
  const blendedPlayerCenter =
    playerCenter1 * (1 - fraction) + playerCenter2 * fraction;

  const centerOffset = blendedPlayerCenter - blendedBandCenter;
  return Math.max(0, scrollTop + centerOffset);
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
