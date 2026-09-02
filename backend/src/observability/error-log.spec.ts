import { ErrorLogRecorder } from './error-log.recorder';
import { ErrorLogRetentionService } from './error-log-retention.service';
import { config } from '../config';

const baseRecord = (over: Partial<any> = {}) => ({
  route: '/api/posts/:id',
  path: '/api/posts/abc',
  method: 'GET',
  statusCode: 500,
  severity: 'UNEXPECTED' as const,
  message: 'boom',
  name: 'Error',
  stack: null,
  requestId: null,
  userId: null,
  adminId: null,
  ip: null,
  userAgent: null,
  ...over,
});

describe('ErrorLogRecorder', () => {
  let createMany: jest.Mock;
  let recorder: ErrorLogRecorder;

  beforeEach(() => {
    createMany = jest.fn().mockResolvedValue({ count: 1 });
    recorder = new ErrorLogRecorder({ errorLog: { createMany } } as any);
  });

  afterEach(async () => {
    await recorder.onModuleDestroy();
  });

  it('records a server error', async () => {
    recorder.record(baseRecord());
    await recorder.flush();
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0][0].data).toHaveLength(1);
  });

  it('ignores client errors unless they are switched on', async () => {
    // A 401 or a 404 is the API working. Recording them by default would bury
    // the 500s that are not.
    expect(config.observability.errorLogs.captureClientErrors).toBe(false);
    recorder.record(baseRecord({ statusCode: 404, severity: 'EXPECTED' }));
    await recorder.flush();
    expect(createMany).not.toHaveBeenCalled();
  });

  it('does not write on the request path', () => {
    // `record` is called from the exception filter, which must not wait on it.
    recorder.record(baseRecord());
    expect(createMany).not.toHaveBeenCalled();
  });

  it('caps how many rows one flush can write', async () => {
    /**
     * The property that matters most. An outage produces errors at the rate the
     * app receives traffic; without a cap the first minute of a database
     * failure would try to write one row per request TO THAT DATABASE.
     */
    const ceiling = Math.max(1, Math.ceil(config.observability.errorLogs.maxPerMinute / 12));
    for (let i = 0; i < ceiling + 50; i++) recorder.record(baseRecord());
    await recorder.flush();
    expect(createMany.mock.calls[0][0].data.length).toBeLessThanOrEqual(ceiling);
  });

  it('drops a failed batch instead of retrying it', async () => {
    // If the database is why these errors exist, retrying the inserts makes the
    // incident worse.
    createMany.mockRejectedValueOnce(new Error('db down'));
    recorder.record(baseRecord());
    await expect(recorder.flush()).resolves.toBeUndefined();

    createMany.mockClear();
    await recorder.flush();
    expect(createMany).not.toHaveBeenCalled();
  });

  it('truncates a message too long for its column', async () => {
    // Prisma renders multi-line messages that comfortably exceed 1000 chars.
    // Letting the insert fail would lose the row entirely.
    recorder.record(baseRecord({ message: 'x'.repeat(5000) }));
    await recorder.flush();
    expect(createMany.mock.calls[0][0].data[0].message.length).toBeLessThanOrEqual(1000);
  });

  it('truncates an over-long stack', async () => {
    recorder.record(baseRecord({ stack: 'y'.repeat(9000) }));
    await recorder.flush();
    expect(createMany.mock.calls[0][0].data[0].stack.length).toBeLessThanOrEqual(4000);
  });

  it('never stores a request body', async () => {
    // The body is the most likely place for a password or a token, and a
    // diagnostics table read by admins is the wrong home for one.
    recorder.record(baseRecord());
    await recorder.flush();
    expect(Object.keys(createMany.mock.calls[0][0].data[0])).not.toContain('body');
  });
});

describe('ErrorLogRetentionService', () => {
  it('keeps a 7-day window by default', () => {
    expect(config.observability.errorLogs.retentionDays).toBe(7);
  });

  it('computes a cutoff that many days back', () => {
    const service = new ErrorLogRetentionService({} as any);
    const days = (Date.now() - service.cutoff.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(config.observability.errorLogs.retentionDays, 1);
  });

  it('deletes only rows older than the cutoff', async () => {
    const findMany = jest.fn().mockResolvedValueOnce([{ id: 'a' }]).mockResolvedValueOnce([]);
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const service = new ErrorLogRetentionService({ errorLog: { findMany, deleteMany } } as any);

    const removed = await service.sweep();

    expect(removed).toBe(1);
    expect(findMany.mock.calls[0][0].where.occurredAt.lt).toBeInstanceOf(Date);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['a'] } } });
  });

  it('sweeps in bounded batches rather than one statement', async () => {
    // A long-neglected table must not be cleared by a delete that holds locks
    // for however long it takes.
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new ErrorLogRetentionService({ errorLog: { findMany, deleteMany: jest.fn() } } as any);
    await service.sweep();
    expect(findMany.mock.calls[0][0].take).toBeGreaterThan(0);
  });

  it('never throws, because it runs from a timer', async () => {
    const service = new ErrorLogRetentionService({
      errorLog: { findMany: jest.fn().mockRejectedValue(new Error('nope')) },
    } as any);
    await expect(service.sweep()).resolves.toBe(0);
  });
});
