import { isRecord, stringField } from './type-guards.util';

describe('isRecord', () => {
  it('accepts plain objects only', () => {
    expect(isRecord({})).toBe(true);
    for (const value of [[], null, undefined, 'a', 1]) {
      expect(isRecord(value)).toBe(false);
    }
  });
});

describe('stringField', () => {
  it('reads a string field', () => {
    expect(stringField({ id: 'a' }, 'id')).toBe('a');
    expect(stringField({ id: '' }, 'id')).toBe('');
  });

  it('is undefined for a missing or non-string field', () => {
    expect(stringField({}, 'id')).toBeUndefined();
    expect(stringField({ id: 5 }, 'id')).toBeUndefined();
    expect(stringField({ id: { $ne: null } }, 'id')).toBeUndefined();
  });

  it('is undefined for anything that is not an object', () => {
    for (const value of [null, undefined, 'id', ['a']]) {
      expect(stringField(value, 'id')).toBeUndefined();
    }
  });
});
