import { OffsetPipe, PageLimitPipe, PageNumberPipe } from './page-params.pipe';

describe('PageLimitPipe', () => {
  const pipe = new PageLimitPipe({ default: 20, max: 50 });

  it.each([
    ['undefined', undefined],
    ['empty string', ''],
    ['NaN text', 'abc'],
    ['zero', '0'],
    ['negative', '-5'],
    ['Infinity', 'Infinity'],
    ['an object', { a: 1 }],
  ])('falls back to the default for %s', (_name, input) => {
    expect(pipe.transform(input)).toBe(20);
  });

  it('passes a normal value through', () => {
    expect(pipe.transform('30')).toBe(30);
  });

  it('floors decimals', () => {
    expect(pipe.transform('7.9')).toBe(7);
  });

  it('treats a decimal below one as unusable', () => {
    expect(pipe.transform('0.5')).toBe(20);
  });

  it('clamps above the maximum', () => {
    expect(pipe.transform('100000')).toBe(50);
  });

  it('takes the first of repeated values', () => {
    expect(pipe.transform(['12', '40'])).toBe(12);
    expect(pipe.transform(['abc', '40'])).toBe(20);
  });
});

describe('OffsetPipe', () => {
  const pipe = new OffsetPipe({ max: 10000 });

  it.each([undefined, '', 'abc', '-1', 'Infinity'])(
    'falls back to 0 for %p',
    (input) => {
      expect(pipe.transform(input)).toBe(0);
    },
  );

  it('keeps zero, normal and floored values', () => {
    expect(pipe.transform('0')).toBe(0);
    expect(pipe.transform('40')).toBe(40);
    expect(pipe.transform('40.8')).toBe(40);
  });

  it('clamps above the maximum', () => {
    expect(pipe.transform('99999999')).toBe(10000);
  });

  it('takes the first of repeated values', () => {
    expect(pipe.transform(['5', '9'])).toBe(5);
  });
});

describe('PageNumberPipe', () => {
  const pipe = new PageNumberPipe({ max: 1000 });

  it.each([undefined, '', 'abc', '0', '-3'])('falls back to 1 for %p', (i) => {
    expect(pipe.transform(i)).toBe(1);
  });

  it('passes, floors and clamps', () => {
    expect(pipe.transform('3')).toBe(3);
    expect(pipe.transform('3.9')).toBe(3);
    expect(pipe.transform('99999999999')).toBe(1000);
    expect(pipe.transform(['2', '7'])).toBe(2);
  });
});
