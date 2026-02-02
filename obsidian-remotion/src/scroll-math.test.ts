import {
  Band,
  NullArray,
  slipPreviews,
  buildInterpolator,
  interpolatorFor,
  InterpolatorSpec,
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

interface BandTestCase {
  spans: NullArray<Band>;
  spanScrollHeight: number;
  previewHeights: NullArray<number>;
  previews: NullArray<Band>;
  previewScrollHeight: number;
}

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

describe("interpolatorFor", () => {
  test("maps 1:1", () => {
    const interpolator = interpolatorFor({
      sourceTop: 0,
      sourceBot: 10,
      targetTop: 0,
      targetBot: 10,
    });

    expect(interpolator(0)).toBe(0);
    expect(interpolator(5)).toBe(5);
    expect(interpolator(10)).toBe(10);
  });
  test("maps 1:2", () => {
    const interpolator = interpolatorFor({
      sourceTop: 0,
      sourceBot: 10,
      targetTop: 0,
      targetBot: 20,
    });

    expect(interpolator(0)).toBe(0);
    expect(interpolator(5)).toBe(10);
    expect(interpolator(10)).toBe(20);
  });

  test("maps offset", () => {
    const interpolator = interpolatorFor({
      sourceTop: 0,
      sourceBot: 10,
      targetTop: 20,
      targetBot: 30,
    });

    expect(interpolator(0)).toBe(20);
    expect(interpolator(5)).toBe(25);
    expect(interpolator(10)).toBe(30);
  });
});

describe("buildInterpolator", () => {
  test("does nothing", () => {
    const spans: NullArray<Band> = [];
    const previews: NullArray<Band> = [];
    const spanScrollHeight = 10;
    const previewScrollHeight = 100;

    const result = buildInterpolator(
      spans,
      spanScrollHeight,
      previews,
      previewScrollHeight,
      5,
      "span",
    );

    expect(result.sourceTop).toBe(0);
    expect(result.sourceBot).toBe(10);
    expect(result.targetTop).toBe(0);
    expect(result.targetBot).toBe(100);
  });

  test("handles document edges", () => {
    // Degenerate case: viewports have height
    // so the "center" will never be at the end
    const spans: NullArray<Band> = [];
    const previews: NullArray<Band> = [];
    const spanScrollHeight = 10;
    const previewScrollHeight = 100;

    const tuneInterpolator = interpolateTestCase({
      spans,
      spanScrollHeight,
      previews,
      previewScrollHeight,
      previewHeights: [],
    });

    const topSpanInterpolator = tuneInterpolator(0, "span");
    const topPreviewInterpolator = tuneInterpolator(0, "preview");
    const bottomSpanInterpolator = tuneInterpolator(10, "span");
    const bottomPreviewInterpolator = tuneInterpolator(100, "preview");

    const topDocument: InterpolatorSpec = {
      sourceTop: 0,
      sourceBot: 0,
      targetTop: 0,
      targetBot: 0,
    };
    const botDocument: InterpolatorSpec = {
      sourceTop: 10,
      sourceBot: 10,
      targetTop: 100,
      targetBot: 100,
    };

    expect(topSpanInterpolator).toEqual(topDocument);
    expect(topPreviewInterpolator).toEqual(topDocument);
    expect(bottomSpanInterpolator).toEqual(botDocument);
    expect(bottomPreviewInterpolator).toEqual(botDocument);
  });

  test("handles single band", () => {
    const tc = parseTestCase(`
01234567
   3
  ---   8
  ===   8
   3
`);
    const tuneInterpolator = interpolateTestCase(tc);

    const nearTopInterpolator = tuneInterpolator(0.1, "span");
    const aboveBandInterpolator = tuneInterpolator(1.9, "span");
    const nearTopBandInterpolator = tuneInterpolator(2.1, "span");
    const nearBotBandInterpolator = tuneInterpolator(4.9, "span");
    const belowBandInterpolator = tuneInterpolator(5.1, "span");
    const nearBotInterpolator = tuneInterpolator(7.9, "span");

    const topInterpolator: InterpolatorSpec = {
      sourceTop: 0,
      sourceBot: 2,
      targetTop: 0,
      targetBot: 2,
    };
    const bandInterpolator: InterpolatorSpec = {
      sourceTop: 2,
      sourceBot: 5,
      targetTop: 2,
      targetBot: 5,
    };
    const botInterpolator: InterpolatorSpec = {
      sourceTop: 5,
      sourceBot: 8,
      targetTop: 5,
      targetBot: 8,
    };

    expect(nearTopInterpolator).toEqual(topInterpolator);
    expect(aboveBandInterpolator).toEqual(topInterpolator);
    expect(nearTopBandInterpolator).toEqual(bandInterpolator);
    expect(nearBotBandInterpolator).toEqual(bandInterpolator);
    expect(belowBandInterpolator).toEqual(botInterpolator);
    expect(nearBotInterpolator).toEqual(botInterpolator);
  });

  it("handles unequal bands", () => {
    const tc = parseTestCase(`
01234567
  1
  -  5
 === 5
  3
`);
    const tuneInterpolator = interpolateTestCase(tc);

    const topSpanInterpolator = tuneInterpolator(0.5, "span");
    const topPreviewInterpolator = tuneInterpolator(0.5, "preview");
    const aboveSpanInterpolator = tuneInterpolator(1.5, "span");
    const abovePreviewInterpolator = tuneInterpolator(1.5, "preview");
    const inSpanInterpolator = tuneInterpolator(2.5, "span");
    const inPreviewInterpolator = tuneInterpolator(2.5, "preview");
    const belowSpanInterpolator = tuneInterpolator(3.5, "span");
    const belowPreviewInterpolator = tuneInterpolator(3.5, "preview");
    const botSpanInterpolator = tuneInterpolator(4.5, "span");
    const botPreviewInterpolator = tuneInterpolator(4.5, "preview");
  });
});

function interpolateTestCase(tc: BandTestCase) {
  return (scrollCenter: number, scrollSource: "span" | "preview") =>
    buildInterpolator(
      tc.spans,
      tc.spanScrollHeight,
      tc.previews,
      tc.previewScrollHeight,
      scrollCenter,
      scrollSource,
    );
}
