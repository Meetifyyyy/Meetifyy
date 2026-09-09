import { Logger } from '@nestjs/common';
import { detach } from './detach.util';

/**
 * `detach` exists to stop background work from killing the server, so the only
 * tests worth writing are the ones that let it fail.
 */
describe('detach', () => {
  let errors: jest.SpyInstance;

  beforeEach(() => {
    errors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => errors.mockRestore());

  it('runs the work', async () => {
    const work = jest.fn().mockResolvedValue('done');
    detach('task', work);
    await Promise.resolve();
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('returns before the work finishes', async () => {
    const order: string[] = [];
    detach('task', async () => {
      await Promise.resolve();
      order.push('work');
    });
    order.push('caller');
    await new Promise((r) => setImmediate(r));
    expect(order).toEqual(['caller', 'work']);
  });

  // The reason the helper exists: this rejection used to reach the process.
  it('contains a rejection instead of letting it escape', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);

    expect(() =>
      detach('failing task', () => Promise.reject(new Error('boom'))),
    ).not.toThrow();
    await new Promise((r) => setImmediate(r));

    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining('failing task'),
      expect.any(Error),
    );
  });

  // An argument that throws does so before the async body starts, so the
  // rejection path above never sees it.
  it('contains a synchronous throw', () => {
    expect(() =>
      detach('throwing task', () => {
        throw new Error('sync boom');
      }),
    ).not.toThrow();
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining('threw synchronously'),
      expect.any(Error),
    );
  });

  it('names the task it is reporting', async () => {
    detach('media cleanup sweep', () => Promise.reject(new Error('x')));
    await new Promise((r) => setImmediate(r));
    expect(errors.mock.calls[0][0]).toContain('media cleanup sweep');
  });
});
