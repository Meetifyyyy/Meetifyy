import { requestBody } from './authenticated-request';

/**
 * Guards read the body before any pipe has validated it, so it can be missing,
 * a string or an array. Each of those must read as "no fields", never throw.
 */
describe('requestBody', () => {
  it('returns the fields of an object body', () => {
    expect(requestBody({ body: { email: 'a@b.c' } })).toEqual({
      email: 'a@b.c',
    });
  });

  it('treats a missing request or body as empty', () => {
    expect(requestBody(undefined)).toEqual({});
    expect(requestBody({})).toEqual({});
    expect(requestBody({ body: null })).toEqual({});
  });

  it('treats a non-object body as empty', () => {
    expect(requestBody({ body: 'email=a@b.c' })).toEqual({});
    expect(requestBody({ body: 42 })).toEqual({});
  });
});
