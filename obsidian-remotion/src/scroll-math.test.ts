import {
  Band,
  NullArray,
  slipPreviews,
  buildInterpolator,
} from "./scroll-math";

describe("parseTestCase", () => {
  test("parses the example format", () => {
    const result = parseTestCase(`
0123456
 3  1 1
--- - - 7
=== = = 8
 3  1 1
`);

    expect(result.spans).toEqual([
      { center: 1.5, height: 3 },
      { center: 4.5, height: 1 },
      { center: 6.5, height: 1 },
    ]);
    expect(result.spanScrollHeight).toEqual(7);
    expect(result.previews).toEqual([
      { center: 1.5, height: 3 },
      { center: 4.5, height: 1 },
      { center: 6.5, height: 1 },
    ]);
    expect(result.previewScrollHeight).toEqual(8);
  });
});

describe("scroll-math", () => {
  test("handles the happy case", () => {
    const tc = parseTestCase(`
01234567
   3
  ---   7
  ===   7
   3
`);
    console.log(tc);

    const result = slipPreviews(
      tc.spans,
      tc.spanScrollHeight,
      tc.previewHeights,
    );
    expect(result.previews).toEqual(tc.previews);
    expect(result.previewScrollHeight).toEqual(tc.previewScrollHeight);
  });

  test("it bonks the top", () => {
    const tc = parseTestCase(`
012345
1
-     5
===   5
 3
`);
    console.log(tc);

    const result = slipPreviews(
      tc.spans,
      tc.spanScrollHeight,
      tc.previewHeights,
    );
    expect(result.previews).toEqual(tc.previews);
    expect(result.previewScrollHeight).toEqual(tc.previewScrollHeight);
  });

  test("it pushes the bottom", () => {
    const tc = parseTestCase(`
01234567
    1
    -  5
   === 6
    3
`);
    console.log(tc);
    const result = slipPreviews(
      tc.spans,
      tc.spanScrollHeight,
      tc.previewHeights,
    );
    expect(result.previews).toEqual(tc.previews);
    expect(result.previewScrollHeight).toEqual(tc.previewScrollHeight);
  });

  test("it pushes collisions downwards", () => {
    const tc = parseTestCase(`
0123456789
11   1
--   - 6
========= 9
 3  3   3
`);
    console.log(tc);

    const result = slipPreviews(
      tc.spans,
      tc.spanScrollHeight,
      tc.previewHeights,
    );
    expect(result.previews).toEqual(tc.previews);
    expect(result.previewScrollHeight).toEqual(tc.previewScrollHeight);
  });
});

function parseTestCase(input: string) {
  const lines = input.trim().split("\n");
  const spanHeightsLine = lines[1];
  const spanLine = lines[2];
  const previewLine = lines[3];
  const previewHeightsLine = lines[4];

  function parseHeights(line: string) {
    const heights = [];
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === " ") {
        continue;
      }
      heights.push(parseInt(char, 10));
    }
    return heights;
  }

  function extractBands(line: string, heights: number[]) {
    const bands: NullArray<Band> = [];
    let currentIndex = 0;
    for (let i = 0; i < heights.length; i++) {
      // find next - or =
      let bandStart = -1;
      for (let j = currentIndex; j < line.length; j++) {
        if (line[j] === "-" || line[j] === "=") {
          bandStart = j;
          break;
        }
      }

      if (bandStart === -1) {
        throw new Error(
          `Invalid test case: not enough bands (looking for band ${i})`,
        );
      }

      const center = bandStart + heights[i] / 2;
      bands.push({ center, height: heights[i] });

      currentIndex = bandStart + heights[i];
    }

    const scrollHeight = parseInt(line.slice(currentIndex).trim(), 10);
    return { bands, scrollHeight };
  }

  const previewHeights = parseHeights(previewHeightsLine);
  const { bands: spans, scrollHeight: spanScrollHeight } = extractBands(
    spanLine,
    parseHeights(spanHeightsLine),
  );
  const { bands: previews, scrollHeight: previewScrollHeight } = extractBands(
    previewLine,
    previewHeights,
  );

  return {
    spans,
    spanScrollHeight,
    previewHeights,
    previews,
    previewScrollHeight,
  };
}

describe("interpolator", () => {
  test("builds an interpolator from two band pairs", () => {
    const spans: NullArray<Band> = [
      { center: 2, height: 1 },
      { center: 8, height: 1 },
    ];
    const previews: NullArray<Band> = [
      { center: 3, height: 1 },
      { center: 9, height: 1 },
    ];

    const result = buildInterpolator(spans, 10, previews, 10, 5, "editor");

    // Should find bands above and below scrollCenter (5)
    expect(result.aTop).toBe(2); // span at center 2
    expect(result.aBot).toBe(8); // span at center 8
    expect(result.bTop).toBe(3); // preview at center 3
    expect(result.bBot).toBe(9); // preview at center 9

    // Test interpolation: map from editor range to preview range
    // Progress from aTop to aBot: (5 - 2) / (8 - 2) = 0.5
    // Result in preview: 3 + 0.5 * (9 - 3) = 6
    const interpolated = result.interpolator(
      result.aTop,
      5,
      result.aBot,
      result.bTop,
      result.bBot,
    );
    expect(interpolated).toBe(6);
  });

  test("falls back to 1:1 mapping when band pairs are incomplete", () => {
    const spans: NullArray<Band> = [{ center: 5, height: 1 }];
    const previews: NullArray<Band> = [{ center: 5, height: 1 }];

    const result = buildInterpolator(spans, 10, previews, 10, 5, "editor");

    // Should fall back to default values
    expect(result.aTop).toBe(5);
    expect(result.aBot).toBe(5);
    expect(result.bTop).toBe(5);
    expect(result.bBot).toBe(5);

    // Interpolation should handle zero range gracefully
    const interpolated = result.interpolator(5, 5, 5, 5, 5);
    expect(interpolated).toBe(5);
  });
});
