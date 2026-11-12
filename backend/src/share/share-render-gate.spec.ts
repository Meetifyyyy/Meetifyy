import {
  SHARE_RENDER_MAX_CONCURRENT,
  SHARE_RENDER_MAX_QUEUED,
  SHARE_RENDER_MAX_WAIT_MS,
  ShareRenderBusyError,
  ShareRenderGate,
} from './share-render-gate';

/** A task the test finishes by hand, and whether it has started. */
interface Task {
  started: boolean;
  done: boolean;
  finish: () => void;
  fail: (error: Error) => void;
  promise: Promise<string>;
}

describe('ShareRenderGate', () => {
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

  /** Finishes whatever has started, repeatedly, until nothing is left. */
  const drain = async (tasks: Task[]) => {
    for (;;) {
      await flush();
      const next = tasks.find((t) => t.started && !t.done);
      if (!next) return;
      next.finish();
    }
  };

  const launch = (
    gate: ShareRenderGate,
    tally?: { running: number; peak: number },
  ) => {
    const task = {} as Task;
    task.started = false;
    task.done = false;
    task.promise = gate.run(
      () =>
        new Promise<string>((resolve, reject) => {
          task.started = true;
          if (tally) {
            tally.running += 1;
            tally.peak = Math.max(tally.peak, tally.running);
          }
          task.finish = () => {
            task.done = true;
            if (tally) tally.running -= 1;
            resolve('done');
          };
          task.fail = (error) => {
            task.done = true;
            if (tally) tally.running -= 1;
            reject(error);
          };
        }),
    );
    return task;
  };

  it('never runs more than the concurrency limit at once', async () => {
    const gate = new ShareRenderGate();
    const tally = { running: 0, peak: 0 };
    const tasks = Array.from({ length: SHARE_RENDER_MAX_CONCURRENT + 3 }, () =>
      launch(gate, tally),
    );
    await flush();

    expect(tasks.filter((t) => t.started)).toHaveLength(
      SHARE_RENDER_MAX_CONCURRENT,
    );

    await drain(tasks);
    expect(tally.peak).toBe(SHARE_RENDER_MAX_CONCURRENT);
  });

  it('starts a queued task, in order, when a slot frees', async () => {
    const gate = new ShareRenderGate(1, 4, 1000);
    const first = launch(gate);
    const second = launch(gate);
    const third = launch(gate);
    await flush();
    expect([first.started, second.started, third.started]).toEqual([
      true,
      false,
      false,
    ]);

    first.finish();
    await first.promise;
    await flush();
    expect([second.started, third.started]).toEqual([true, false]);

    second.finish();
    await second.promise;
    await flush();
    expect(third.started).toBe(true);
    third.finish();
    await third.promise;
  });

  it('refuses a caller that arrives with the queue full, without running it', async () => {
    const gate = new ShareRenderGate();
    const admitted = Array.from(
      { length: SHARE_RENDER_MAX_CONCURRENT + SHARE_RENDER_MAX_QUEUED },
      () => launch(gate),
    );
    await flush();

    const fn = jest.fn(() => Promise.resolve('never'));
    await expect(gate.run(fn)).rejects.toBeInstanceOf(ShareRenderBusyError);
    expect(fn).not.toHaveBeenCalled();

    // Everyone admitted is still served once slots free up.
    await drain(admitted);
    await expect(
      Promise.all(admitted.map((t) => t.promise)),
    ).resolves.toHaveLength(admitted.length);
  });

  it('refuses a queued caller that waits longer than the limit', async () => {
    jest.useFakeTimers();
    try {
      const gate = new ShareRenderGate(1, 4, SHARE_RENDER_MAX_WAIT_MS);
      const holder = launch(gate);
      const fn = jest.fn(() => Promise.resolve('never'));
      const waiting = gate.run(fn);
      const outcome = waiting.then(
        () => 'ran',
        (error: unknown) => error,
      );

      await jest.advanceTimersByTimeAsync(SHARE_RENDER_MAX_WAIT_MS + 1);
      expect(await outcome).toBeInstanceOf(ShareRenderBusyError);

      // The abandoned waiter left the queue: freeing the slot must not start it.
      holder.finish();
      await holder.promise;
      expect(fn).not.toHaveBeenCalled();

      // And the slot is genuinely free for the next caller.
      await expect(gate.run(() => Promise.resolve('ok'))).resolves.toBe('ok');
    } finally {
      jest.useRealTimers();
    }
  });

  it('frees the slot when the work fails', async () => {
    const gate = new ShareRenderGate(1, 1, 1000);
    const failing = launch(gate);
    const next = launch(gate);
    await flush();

    failing.fail(new Error('decode failed'));
    await expect(failing.promise).rejects.toThrow('decode failed');
    await flush();

    expect(next.started).toBe(true);
    next.finish();
    await next.promise;
  });
});
