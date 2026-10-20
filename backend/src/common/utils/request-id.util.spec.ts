import { requestIdFrom } from './request-id.util';

describe('requestIdFrom', () => {
  it.each(['abc-123', 'a.b_c-D9', 'x'.repeat(64)])('keeps %s', (id) => {
    expect(requestIdFrom(id)).toBe(id);
  });

  it.each([
    'x'.repeat(65),
    'has space',
    'line\nbreak',
    '{"level":"error"}',
    'semi;colon',
    '',
  ])('replaces %j with a generated id', (bad) => {
    const id = requestIdFrom(bad);
    expect(id).not.toBe(bad);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('generates a unique id when the header is absent', () => {
    expect(requestIdFrom(undefined)).not.toBe(requestIdFrom(undefined));
  });

  it('uses the first value of a repeated header, validated', () => {
    expect(requestIdFrom(['ok-1', 'bad value'])).toBe('ok-1');
    expect(requestIdFrom(['bad value'])).toMatch(/^[0-9a-f-]{36}$/);
  });
});
