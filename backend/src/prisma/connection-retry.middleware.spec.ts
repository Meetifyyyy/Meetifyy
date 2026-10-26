import {
  CONNECTION_RETRIES,
  connectionRetryMiddleware,
  isTransientConnectionError,
} from './connection-retry.middleware';
import { DatabaseUnavailableError } from './database-unavailable.error';

/**
 * PrismaService's query middleware. Two things it must never do again: hand a
 * caller `undefined` for a query it did not run (MEETIFYY-API-C, -G), and give
 * up at once on a connection the pooler refused for a moment (MEETIFYY-API-6).
 */
describe('connectionRetryMiddleware', () => {
  const setup = (closed = false) => {
    let isClosed = closed;
    const warn = jest.fn<void, [string]>();
    const sleep = jest.fn<Promise<void>, [number]>(() => Promise.resolve());
    const middleware = connectionRetryMiddleware({
      isClosed: () => isClosed,
      warn,
      sleep,
    });
    return { middleware, warn, sleep, close: () => (isClosed = true) };
  };

  it('passes a result through unchanged', async () => {
    const { middleware } = setup();
    const next = jest.fn<Promise<unknown>, [string]>(() =>
      Promise.resolve({ count: 2 }),
    );
    await expect(middleware('params', next)).resolves.toEqual({ count: 2 });
    expect(next).toHaveBeenCalledWith('params');
  });

  it('throws, never resolves undefined, once the database has closed', async () => {
    const { middleware } = setup(true);
    const next = jest.fn<Promise<unknown>, [string]>();
    await expect(middleware('params', next)).rejects.toBeInstanceOf(
      DatabaseUnavailableError,
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('turns a query cut off by the pool closing into DatabaseUnavailableError', async () => {
    const { middleware } = setup();
    const next = jest.fn<Promise<unknown>, [string]>(() =>
      Promise.reject(
        new Error('Cannot use a pool after calling end on the pool'),
      ),
    );
    await expect(middleware('params', next)).rejects.toBeInstanceOf(
      DatabaseUnavailableError,
    );
  });

  it('retries a refused connection, then succeeds', async () => {
    const { middleware, warn, sleep } = setup();
    const refused = new Error(
      'Error occurred during query execution: ConnectorError(... PostgresError { code: "08006", message: "Failed to connect to database: {:error, :econnrefused}" })',
    );
    const next = jest
      .fn<Promise<unknown>, [string]>()
      .mockRejectedValueOnce(refused)
      .mockResolvedValueOnce([{ id: 1 }]);
    await expect(middleware('params', next)).resolves.toEqual([{ id: 1 }]);
    expect(next).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('fails with the original error once the retries are spent', async () => {
    const { middleware } = setup();
    const refused = new Error('connect ECONNREFUSED 10.0.0.1:6543');
    const next = jest.fn<Promise<unknown>, [string]>(() =>
      Promise.reject(refused),
    );
    await expect(middleware('params', next)).rejects.toBe(refused);
    expect(next).toHaveBeenCalledTimes(CONNECTION_RETRIES + 1);
  });

  it('does not retry an error about the query itself', async () => {
    const { middleware } = setup();
    const constraint = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
    });
    const next = jest.fn<Promise<unknown>, [string]>(() =>
      Promise.reject(constraint),
    );
    await expect(middleware('params', next)).rejects.toBe(constraint);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('recognises the connection failures seen in Sentry', () => {
    expect(
      isTransientConnectionError(
        new Error('Failed to connect to database: {:error, :econnrefused}'),
      ),
    ).toBe(true);
    expect(
      isTransientConnectionError(
        new Error('Connection terminated unexpectedly'),
      ),
    ).toBe(true);
    expect(isTransientConnectionError({ code: 'P1001', message: '' })).toBe(
      true,
    );
    expect(
      isTransientConnectionError(
        new Error('operator does not exist: text + double precision'),
      ),
    ).toBe(false);
  });
});
