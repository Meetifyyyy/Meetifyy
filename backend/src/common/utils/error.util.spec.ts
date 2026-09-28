import { errorMessage, errorStack } from './error.util';

describe('errorMessage', () => {
  it('gives the message of an Error', () => {
    expect(errorMessage(new TypeError('boom'))).toBe('boom');
  });

  it('gives a thrown string as-is', () => {
    expect(errorMessage('plain failure')).toBe('plain failure');
  });

  it('serialises a thrown object rather than printing undefined', () => {
    expect(errorMessage({ code: 'E1' })).toBe('{"code":"E1"}');
  });

  it('survives null, undefined and circular objects', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('undefined');
    expect(errorMessage(circular)).toBe('[object Object]');
  });
});

describe('errorStack', () => {
  it('gives the stack of an Error and nothing for other values', () => {
    expect(errorStack(new Error('x'))).toContain('Error: x');
    expect(errorStack('x')).toBeUndefined();
  });
});
