import type { Worker } from 'bullmq';
import { DrainingWorkerHost } from './draining-worker-host';

/** A processor's worker closes before the database does (see the class). */
class TestProcessor extends DrainingWorkerHost {
  process(): Promise<void> {
    return Promise.resolve();
  }
}

/** Gives the host a worker the way @nestjs/bullmq does, through `_worker`. */
function withWorker(
  host: TestProcessor,
  worker: Pick<Worker, 'close'> | undefined,
) {
  (host as unknown as { _worker: unknown })._worker = worker;
  return host;
}

describe('DrainingWorkerHost', () => {
  it('closes its worker before application shutdown', async () => {
    const close = jest.fn<Promise<void>, [boolean?]>(() => Promise.resolve());
    const host = withWorker(new TestProcessor(), { close });
    await host.beforeApplicationShutdown();
    // Not forced: the job in hand finishes, no new one is taken.
    expect(close).toHaveBeenCalledWith();
  });

  it('does nothing when the worker was never initialised', async () => {
    const host = withWorker(new TestProcessor(), undefined);
    await expect(host.beforeApplicationShutdown()).resolves.toBeUndefined();
  });

  it('does not throw when the worker fails to close', async () => {
    const close = jest.fn<Promise<void>, [boolean?]>(() =>
      Promise.reject(new Error('redis gone')),
    );
    const host = withWorker(new TestProcessor(), { close });
    await expect(host.beforeApplicationShutdown()).resolves.toBeUndefined();
  });
});
