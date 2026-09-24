import { isJsonValue } from './json.util';

describe('isJsonValue', () => {
  it('accepts what a parsed request body can contain', () => {
    for (const v of [
      null,
      'a',
      0,
      1.5,
      true,
      [],
      {},
      { a: [1, { b: null }] },
    ]) {
      expect(isJsonValue(v)).toBe(true);
    }
  });

  it('refuses values JSON cannot represent', () => {
    for (const v of [
      undefined,
      NaN,
      Infinity,
      () => 1,
      new Date(),
      { d: new Date() },
      [1n],
    ]) {
      expect(isJsonValue(v)).toBe(false);
    }
  });

  it('ignores undefined properties, which JSON drops anyway', () => {
    expect(isJsonValue({ a: undefined, b: 1 })).toBe(true);
  });
});
