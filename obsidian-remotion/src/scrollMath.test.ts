import { layoutPlayers, type ScrollState, mapScroll } from "./scrollMath";
import type { PixelBand } from "./scroll";

describe("layoutPlayersWithHeight", () => {
  test("preserves large gaps", () => {
    const source: Array<PixelBand | null> = [
      { top: 0, height: 20 },
      null,
      { top: 1000, height: 20 },
    ];

    const heights = [50, 0, 50];

    const result = layoutPlayers(source, 1100, heights);

    expect(result.positions[0]?.top).toBeCloseTo(-15);
    expect(result.positions[2]!.top - result.positions[0]!.top).toBeGreaterThan(
      900,
    );
  });

  test("extends viewport height as needed", () => {
    const source: Array<PixelBand | null> = [
      { top: 0, height: 20 },
      { top: 30, height: 20 },
    ];

    const heights = [500, 500];

    const result = layoutPlayers(source, 100, heights);

    expect(result.positions[0]?.top).toBeCloseTo(-240);
    expect(result.positions[1]?.top).toBeCloseTo(
      result.positions[0]!.top + result.positions[0]!.height + 16,
    );
  });

  test("prevents overlap", () => {
    const source: Array<PixelBand | null> = [
      { top: 0, height: 20 },
      { top: 10, height: 20 },
    ];

    const heights = [50, 50];

    const result = layoutPlayers(source, 50, heights);

    expect(result.positions[1]!.top).toBeGreaterThan(
      result.positions[0]!.top + result.positions[0]!.height,
    );
  });

  test("uses default height when not provided", () => {
    const source: Array<PixelBand | null> = [{ top: 0, height: 20 }];

    const heights: number[] = [];

    const result = layoutPlayers(source, 100, heights);

    expect(result.positions[0]?.height).toBe(400); // default height
  });

  test("handles null bands", () => {
    const source: Array<PixelBand | null> = [
      { top: 0, height: 20 },
      null,
      { top: 100, height: 20 },
    ];

    const heights = [50, 0, 50];

    const result = layoutPlayers(source, 150, heights);

    expect(result.positions[0]).not.toBeNull();
    expect(result.positions[1]).toBeNull();
    expect(result.positions[2]).not.toBeNull();
  });

  test("enforces minimum gap between consecutive players", () => {
    const source: Array<PixelBand | null> = [
      { top: 0, height: 10 },
      { top: 15, height: 10 },
    ];

    const heights = [30, 30];

    const result = layoutPlayers(source, 50, heights);

    // Gap should be at least 16px (minGap)
    const gap =
      result.positions[1]!.top -
      (result.positions[0]!.top + result.positions[0]!.height);
    expect(gap).toBeGreaterThanOrEqual(16);
  });
});

describe("computePlayerScrollTop", () => {
  test("aligns active band centers", () => {
    const bands: PixelBand[] = [
      { top: 0, height: 100 },
      { top: 200, height: 100 },
    ];

    const previews: PixelBand[] = [
      { top: 0, height: 300 },
      { top: 400, height: 300 },
    ];

    const state: ScrollState = { lastActiveIndex: null };

    const scroll = mapScroll(
      bands,
      50, // center on band 0
      100,
      previews,
      100,
      state,
    );

    expect(scroll).toBeCloseTo(100); // preview center = 150
  });

  test("hysteresis prevents jitter", () => {
    const bands: PixelBand[] = [
      { top: 0, height: 100 },
      { top: 120, height: 100 },
    ];

    const previews: PixelBand[] = [
      { top: 0, height: 200 },
      { top: 300, height: 200 },
    ];

    const state: ScrollState = { lastActiveIndex: null };

    mapScroll(bands, 40, 100, previews, 100, state);
    const s2 = mapScroll(bands, 45, 100, previews, 100, state);

    expect(state.lastActiveIndex).toBe(0);
  });

  test("handles empty bands", () => {
    const state: ScrollState = { lastActiveIndex: null };
    const scroll = mapScroll([], 100, 100, [], 100, state);
    expect(scroll).toBe(0);
  });

  test("handles null bands", () => {
    const bands: (PixelBand | null)[] = [null, { top: 100, height: 50 }];
    const previews: (PixelBand | null)[] = [null, { top: 200, height: 100 }];
    const state: ScrollState = { lastActiveIndex: null };

    const scroll = mapScroll(bands, 100, 100, previews, 100, state);
    expect(scroll).toBeGreaterThanOrEqual(0);
  });

  test("switches active index when scrolling far enough", () => {
    const bands: PixelBand[] = [
      { top: 0, height: 100 },
      { top: 200, height: 100 },
    ];

    const previews: PixelBand[] = [
      { top: 0, height: 200 },
      { top: 300, height: 200 },
    ];

    const state: ScrollState = { lastActiveIndex: null };

    // Start viewing first band
    mapScroll(bands, 0, 100, previews, 100, state);
    expect(state.lastActiveIndex).toBe(0);

    // Scroll to second band
    mapScroll(bands, 200, 100, previews, 100, state);
    expect(state.lastActiveIndex).toBe(1);
  });
});

describe("computeEditorScrollFromPlayerScroll", () => {
  test("reverse maps from player to editor", () => {
    const bands: PixelBand[] = [
      { top: 0, height: 100 },
      { top: 200, height: 100 },
    ];

    const previews: PixelBand[] = [
      { top: 0, height: 300 },
      { top: 400, height: 300 },
    ];

    const state: ScrollState = { lastActiveIndex: null };

    // If player is centered on first preview
    const editorScroll = mapScroll(
      previews,
      100, // player scrollTop
      100,
      bands,
      100,
      state,
    );

    // Should center on first band
    expect(editorScroll).toBeCloseTo(0);
  });

  test("maintains hysteresis in reverse direction", () => {
    const bands: PixelBand[] = [
      { top: 0, height: 100 },
      { top: 120, height: 100 },
    ];

    const previews: PixelBand[] = [
      { top: 0, height: 200 },
      { top: 300, height: 200 },
    ];

    const state: ScrollState = { lastActiveIndex: null };

    mapScroll(previews, 50, 100, bands, 100, state);
    expect(state.lastActiveIndex).toBe(0);

    // Small scroll should maintain same index
    mapScroll(previews, 60, 100, bands, 100, state);
    expect(state.lastActiveIndex).toBe(0);
  });

  test("handles empty bands in reverse", () => {
    const state: ScrollState = { lastActiveIndex: null };
    const scroll = mapScroll([], 100, 100, [], 100, state);
    expect(scroll).toBe(0);
  });
});

describe("bidirectional scroll mapping", () => {
  test("forward and reverse maintain same active region", () => {
    const bands: PixelBand[] = [
      { top: 0, height: 100 },
      { top: 200, height: 100 },
    ];

    const previews: PixelBand[] = [
      { top: 0, height: 200 },
      { top: 300, height: 200 },
    ];

    const forwardState: ScrollState = { lastActiveIndex: null };
    const reverseState: ScrollState = { lastActiveIndex: null };

    // Map forward - viewing first band
    const playerScroll = mapScroll(bands, 50, 100, previews, 100, forwardState);

    // Map back
    const editorScroll = mapScroll(
      previews,
      playerScroll,
      100,
      bands,
      100,
      reverseState,
    );

    // Both should agree on the active region (first band/preview)
    expect(forwardState.lastActiveIndex).toBe(0);
    expect(reverseState.lastActiveIndex).toBe(0);
    // Editor scroll should keep first band centered
    expect(editorScroll).toBeGreaterThanOrEqual(0);
    expect(editorScroll).toBeLessThan(100);
  });

  test("separate states prevent interference", () => {
    const bands: PixelBand[] = [
      { top: 0, height: 100 },
      { top: 200, height: 100 },
    ];

    const previews: PixelBand[] = [
      { top: 0, height: 200 },
      { top: 300, height: 200 },
    ];

    const forwardState: ScrollState = { lastActiveIndex: null };
    const reverseState: ScrollState = { lastActiveIndex: null };

    // Use forward mapping
    mapScroll(bands, 50, 100, previews, 100, forwardState);
    expect(forwardState.lastActiveIndex).toBe(0);

    // Use reverse mapping
    mapScroll(previews, 350, 100, bands, 100, reverseState);
    expect(reverseState.lastActiveIndex).toBe(1);

    // Forward state should be unchanged
    expect(forwardState.lastActiveIndex).toBe(0);
  });
});
