import { generatePublicId } from './public-id.util';

describe('generatePublicId', () => {
  const ALPHANUMERIC_PATTERN = /^[A-Za-z0-9]+$/;

  describe('default length (12)', () => {
    it('returns a string of length 12', () => {
      const id = generatePublicId();
      expect(id).toHaveLength(12);
    });

    it('contains only alphanumeric characters', () => {
      const id = generatePublicId();
      expect(id).toMatch(ALPHANUMERIC_PATTERN);
    });
  });

  describe('custom lengths', () => {
    it.each([6, 8, 16, 24, 32])('returns a string of length %d', (len) => {
      expect(generatePublicId(len)).toHaveLength(len);
    });

    it('contains only alphanumeric characters for each custom length', () => {
      [6, 16, 32].forEach((len) => {
        expect(generatePublicId(len)).toMatch(ALPHANUMERIC_PATTERN);
      });
    });
  });

  describe('uniqueness', () => {
    it('generates different values on successive calls', () => {
      const ids = new Set(
        Array.from({ length: 100 }, () => generatePublicId()),
      );
      // With 62^12 possible values the probability of any collision in 100
      // draws is astronomically small — treat a collision as a test failure.
      expect(ids.size).toBe(100);
    });
  });

  describe('character alphabet', () => {
    it('uses only the 62-character URL-safe alphabet (A-Z, a-z, 0-9)', () => {
      // Generate a large sample and assert no forbidden characters appear.
      const sample = Array.from({ length: 500 }, () =>
        generatePublicId(20),
      ).join('');
      // Must NOT contain +, /, =, -, _ or any other non-alphanumeric character
      expect(sample).toMatch(/^[A-Za-z0-9]+$/);
    });
  });
});
