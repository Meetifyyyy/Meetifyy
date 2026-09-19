import { UserSessionRetentionService } from './user-session-retention.service';

/**
 * `purgeExpired` was written, tested, and never called. Nothing scheduled it,
 * so the session table only grew — every sign-in a row, every rotation another,
 * and nothing ever removed the ones that had aged out.
 */
describe('UserSessionRetentionService', () => {
  const build = (purgeExpired: jest.Mock) =>
    new UserSessionRetentionService({ purgeExpired } as any);

  afterEach(() => jest.useRealTimers());

  it('sweeps once at boot', async () => {
    const purgeExpired = jest.fn().mockResolvedValue(3);
    const service = build(purgeExpired);

    await service.onModuleInit();

    expect(purgeExpired).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
  });

  it('keeps sweeping on the interval', async () => {
    jest.useFakeTimers();
    const purgeExpired = jest.fn().mockResolvedValue(0);
    const service = build(purgeExpired);

    await service.onModuleInit();
    jest.advanceTimersByTime(6 * 60 * 60 * 1000);
    jest.advanceTimersByTime(6 * 60 * 60 * 1000);

    expect(purgeExpired).toHaveBeenCalledTimes(3);
    service.onModuleDestroy();
  });

  it('never throws — it runs at boot, and a failed sweep must not be a failed boot', async () => {
    const purgeExpired = jest.fn().mockRejectedValue(new Error('db down'));
    const service = build(purgeExpired);

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    await expect(service.sweep()).resolves.toBe(0);
    service.onModuleDestroy();
  });

  it('stops its timer on shutdown', async () => {
    jest.useFakeTimers();
    const purgeExpired = jest.fn().mockResolvedValue(0);
    const service = build(purgeExpired);

    await service.onModuleInit();
    service.onModuleDestroy();
    jest.advanceTimersByTime(24 * 60 * 60 * 1000);

    expect(purgeExpired).toHaveBeenCalledTimes(1);
  });
});
