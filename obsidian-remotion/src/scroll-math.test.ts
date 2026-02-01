import { Band, slipBands } from "./scroll-math";

describe("scroll-math", () => {
  test("handles the happy case", () => {
    /* a b
    1
    2    |
    3  | |
    4    |
    5
    */
    const a: Band[] = [{ center: 3, height: 1 }];
    const aScrollHeight = 5;
    const bBandHeights: number[] = [3];

    const b: Band[] = [{ center: 3, height: 3 }];
    const bScrollHeight = 5;

    expect(slipBands(a, aScrollHeight, bBandHeights)).toEqual([
      b,
      bScrollHeight,
    ]);
  });

  test("it bonks the top", () => {
    /* a b
    1  | |
    2    |
    3    |
    4
    5
    */
    const a: Band[] = [{ center: 1, height: 1 }];
    const aScrollHeight = 5;
    const bBandHeights: number[] = [3];

    const b: Band[] = [{ center: 2, height: 3 }];
    const bScrollHeight = 5;

    expect(slipBands(a, aScrollHeight, bBandHeights)).toEqual([
      b,
      bScrollHeight,
    ]);
  });

  test("it pushes the bottom", () => {
    /* a  b
    1
    2
    3
    4    |
    5  | |
    6    |
    */
    const a: Band[] = [{ center: 5, height: 1 }];
    const aScrollHeight = 5;
    const bBandHeights: number[] = [3];

    const b: Band[] = [{ center: 5, height: 3 }];
    const bScrollHeight = 6;

    expect(slipBands(a, aScrollHeight, bBandHeights)).toEqual([
      b,
      bScrollHeight,
    ]);
  });

  test("it pushes collisions downwards", () => {
    /* a  b
    1
    2     |
    3  |  |
    4     |
    5  |  |
    6     |
    7     |
    */
    const a: Band[] = [
      { center: 3, height: 1 },
      { center: 5, height: 1 },
    ];
    const aScrollHeight = 5;
    const bBandHeights: number[] = [3, 3];

    const b: Band[] = [
      { center: 3, height: 3 },
      { center: 6, height: 3 },
    ];
    const bScrollHeight = 7;

    expect(slipBands(a, aScrollHeight, bBandHeights)).toEqual([
      b,
      bScrollHeight,
    ]);
  });
});
