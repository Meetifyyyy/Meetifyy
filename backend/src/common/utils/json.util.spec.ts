import { isJsonObject, isJsonValue } from './json.util';

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

describe('isJsonObject', () => {
  it('accepts an object read from a Json column', () => {
    expect(isJsonObject({ a: 1 })).toBe(true);
    expect(isJsonObject({})).toBe(true);
  });

  it('rejects arrays, scalars, null and undefined', () => {
    for (const value of [[], [1], 'a', 1, true, null, undefined]) {
      expect(isJsonObject(value)).toBe(false);
    }
  });
});
