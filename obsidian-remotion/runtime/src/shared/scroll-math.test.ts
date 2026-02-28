import {
  Band,
  NullArray,
  slipPreviews,
  buildInterpolators,
  findInterpolatorRegion,
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
      100,
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
      100,
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
      100,
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
      100,
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
    const interpolator = interpolatorFor(
      {
        leftTop: 0,
        leftBot: 10,
        rightTop: 0,
        rightBot: 10,
      },
      "right",
    );

    expect(interpolator(0)).toBe(0);
    expect(interpolator(5)).toBe(5);
    expect(interpolator(10)).toBe(10);
  });
  test("maps 1:2", () => {
    const interpolator = interpolatorFor(
      {
        leftTop: 0,
        leftBot: 10,
        rightTop: 0,
        rightBot: 20,
      },
      "right",
    );

    expect(interpolator(0)).toBe(0);
    expect(interpolator(5)).toBe(10);
    expect(interpolator(10)).toBe(20);
  });

  test("maps offset", () => {
    const interpolator = interpolatorFor(
      {
        leftTop: 0,
        leftBot: 10,
        rightTop: 20,
        rightBot: 30,
      },
      "right",
    );

    expect(interpolator(0)).toBe(20);
    expect(interpolator(5)).toBe(25);
    expect(interpolator(10)).toBe(30);
  });

  test("maps other offset", () => {
    const interpolator = interpolatorFor(
      {
        leftTop: 20,
        leftBot: 30,
        rightTop: 0,
        rightBot: 10,
      },
      "right",
    );

    expect(interpolator(20)).toBe(0);
    expect(interpolator(25)).toBe(5);
    expect(interpolator(30)).toBe(10);
  });
});

describe("buildInterpolator", () => {
  test("does nothing", () => {
    const spans: NullArray<Band> = [];
    const previews: NullArray<Band> = [];
    const spanScrollHeight = 10;
    const previewScrollHeight = 100;

    const result = buildInterpolators(
      spans,
      spanScrollHeight,
      previews,
      previewScrollHeight,
    );

    expect(result).toEqual([
      {
        leftTop: 0,
        leftBot: 10,
        rightTop: 0,
        rightBot: 100,
      },
    ]);
  });

  test("handles single band", () => {
    const tc = parseTestCase(`
01234567
   3
  ---   8
  ===   8
   3
`);
    const specs = interpolateTestCase(tc);

    const topSpec: InterpolatorSpec = {
      leftTop: 0,
      leftBot: 2,
      rightTop: 0,
      rightBot: 2,
    };
    const bandSpec: InterpolatorSpec = {
      leftTop: 2,
      leftBot: 5,
      rightTop: 2,
      rightBot: 5,
    };
    const botSpec: InterpolatorSpec = {
      leftTop: 5,
      leftBot: 8,
      rightTop: 5,
      rightBot: 8,
    };

    expect(specs).toEqual([topSpec, bandSpec, botSpec]);
  });

  it("handles pushed bands", () => {
    const tc = parseTestCase(`
01234567
  1
  -  5
 === 5
  3
`);
    const specs = interpolateTestCase(tc);

    const topSpec: InterpolatorSpec = {
      leftTop: 0,
      leftBot: 2,
      rightTop: 0,
      rightBot: 2,
    };
    const bandSpec: InterpolatorSpec = {
      leftTop: 2,
      leftBot: 3,
      rightTop: 2,
      rightBot: 3,
    };
    const botSpec: InterpolatorSpec = {
      leftTop: 3,
      leftBot: 5,
      rightTop: 3,
      rightBot: 5,
    };

    expect(specs).toEqual([topSpec, bandSpec, botSpec]);
  });
});

function interpolateTestCase(tc: BandTestCase) {
  return buildInterpolators(
    tc.spans,
    tc.spanScrollHeight,
    tc.previews,
    tc.previewScrollHeight,
  );
}
