import { ShortLivedValue } from './short-lived-value.util';

describe('ShortLivedValue', () => {
  let clock = 0;
  const now = () => clock;

  beforeEach(() => {
    clock = 1_000;
  });

  it('computes once per window and shares it', async () => {
    const value = new ShortLivedValue<number>(30_000, now);
    const compute = jest.fn(() => Promise.resolve(7));
    await expect(value.get(compute)).resolves.toBe(7);
    clock += 29_999;
    await expect(value.get(compute)).resolves.toBe(7);
    expect(compute).toHaveBeenCalledTimes(1);
    clock += 1;
    await value.get(compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('lets callers that arrive together share one computation', async () => {
    const value = new ShortLivedValue<number>(30_000, now);
    let release = (_n: number) => {};
    const compute = jest.fn(
      () => new Promise<number>((resolve) => (release = resolve)),
    );
    const both = Promise.all([value.get(compute), value.get(compute)]);
    release(3);
    await expect(both).resolves.toEqual([3, 3]);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('does not keep a failure: the next call tries again', async () => {
    const value = new ShortLivedValue<number>(30_000, now);
    await expect(
      value.get(() => Promise.reject(new Error('down'))),
    ).rejects.toThrow('down');
    await expect(value.get(() => Promise.resolve(5))).resolves.toBe(5);
  });
});
