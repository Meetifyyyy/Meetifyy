import { requestIdOf } from './rate-limit.response';

/**
 * The id echoed in a 429 body. pino-http types it as `string | number | object`;
 * this app generates strings, but a client that repeats `x-request-id` makes
 * Node hand over an array, and nothing should echo `[object Object]`.
 */
describe('requestIdOf', () => {
  it('passes a string id through unchanged', () => {
    expect(requestIdOf({ id: 'a1b2' })).toBe('a1b2');
  });

  it('stringifies a numeric id', () => {
    expect(requestIdOf({ id: 7 })).toBe('7');
  });

  it('joins a repeated header', () => {
    expect(requestIdOf({ id: ['a', 'b'] })).toBe('a,b');
  });

  it('omits anything else', () => {
    expect(requestIdOf({})).toBeUndefined();
    expect(requestIdOf({ id: { nested: true } })).toBeUndefined();
  });
});
