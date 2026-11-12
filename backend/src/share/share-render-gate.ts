/**
 * Caps how many share cards are rasterised at once in this process.
 *
 * WHY A GLOBAL CAP WHEN THERE IS ALREADY A PER-KEY LOCK
 * The lock in ShareCardCache only serialises requests for the SAME card.
 * `share/post/:id/image.jpg` is unauthenticated, so anyone can ask for a
 * hundred different post ids and every one of them is a cache miss that decodes
 * photographs and rasterises an SVG at the same moment, on a container with half
 * a CPU and 1 GiB shared with the API. That is a denial of service that costs
 * the attacker a loop. The cap turns it into a bounded amount of work plus a
 * clean "try again" for the surplus.
 *
 * WHY THE LIMITS ARE THESE
 * - Two at once: a render is a few hundred milliseconds of CPU plus up to 4 s
 *   spent waiting on media downloads, so a second render overlaps the first's
 *   network wait and keeps the CPU busy without a third one only adding memory
 *   (each holds up to two 6 MB downloads plus decoded pixels).
 * - Eight waiting: the queue exists to absorb the burst a freshly shared link
 *   produces, not to hold an attack. Eight is a few seconds of work at two
 *   slots; beyond that a caller is better served by an immediate 503, which
 *   unfurlers retry, than by holding a socket open.
 * - Five seconds in the queue: the per-card Redis lock is taken for 10 s, and
 *   a waiter that sits in the queue consumes part of that. Capping the wait
 *   keeps queue time plus render time inside it.
 */
export const SHARE_RENDER_MAX_CONCURRENT = 2;
export const SHARE_RENDER_MAX_QUEUED = 8;
export const SHARE_RENDER_MAX_WAIT_MS = 5_000;

/** Seconds a refused caller is told to wait before asking again. */
export const SHARE_RENDER_RETRY_AFTER_SECONDS = 5;

/** The render capacity is used up and the queue is full or too slow. */
export class ShareRenderBusyError extends Error {
  constructor() {
    super('Share card rendering is at capacity');
    this.name = 'ShareRenderBusyError';
  }
}

interface Waiter {
  start: () => void;
  timer: NodeJS.Timeout;
}

/** A counting semaphore with a bounded, time-limited wait queue. */
export class ShareRenderGate {
  private running = 0;
  private readonly queue: Waiter[] = [];

  constructor(
    private readonly maxConcurrent = SHARE_RENDER_MAX_CONCURRENT,
    private readonly maxQueued = SHARE_RENDER_MAX_QUEUED,
    private readonly maxWaitMs = SHARE_RENDER_MAX_WAIT_MS,
  ) {}

  /**
   * Runs `fn` once a slot is free. Rejects with ShareRenderBusyError, without
   * running `fn`, when the queue is full or the wait exceeds the limit.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running += 1;
      return Promise.resolve();
    }
    if (this.queue.length >= this.maxQueued) {
      return Promise.reject(new ShareRenderBusyError());
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        // The slot is handed over by release() without the count dropping, so
        // a request arriving in between cannot jump the queue.
        start: resolve,
        timer: setTimeout(() => {
          const index = this.queue.indexOf(waiter);
          if (index === -1) return;
          this.queue.splice(index, 1);
          reject(new ShareRenderBusyError());
        }, this.maxWaitMs),
      };
      // A pending timer must not hold the process open at shutdown.
      waiter.timer.unref();
      this.queue.push(waiter);
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (!next) {
      this.running -= 1;
      return;
    }
    clearTimeout(next.timer);
    next.start();
  }
}
