import { WorkerHost } from '@nestjs/bullmq';
import { BeforeApplicationShutdown, Logger } from '@nestjs/common';
import { errorMessage } from '../utils/error.util';

/**
 * A BullMQ processor whose worker stops BEFORE the database closes.
 *
 * Nest runs shutdown hooks in three passes: every `onModuleDestroy`, then
 * every `beforeApplicationShutdown`, then every `onApplicationShutdown`.
 * @nestjs/bullmq closes its workers in the LAST pass, while PrismaService used
 * to close the database in the FIRST. So on every shutdown — each watch-mode
 * restart, each deploy rolling a replica — workers went on taking and running
 * jobs against a closed database. The Prisma middleware then answered every
 * query with `undefined`, and the jobs crashed far from the cause ("Cannot read
 * properties of undefined (reading 'count')", "expired is not iterable":
 * MEETIFYY-API-C, MEETIFYY-API-G in Sentry).
 *
 * `beforeApplicationShutdown` runs after every module's `onModuleDestroy` and
 * before anything closes the database (PrismaService now disconnects in
 * `onApplicationShutdown`), so closing the worker here lets the job in hand
 * finish and takes no new one. Extend this instead of `WorkerHost`.
 */
export abstract class DrainingWorkerHost
  extends WorkerHost
  implements BeforeApplicationShutdown
{
  async beforeApplicationShutdown(): Promise<void> {
    let worker: WorkerHost['worker'];
    try {
      worker = this.worker;
    } catch {
      // Never initialised (queues disabled, or shutdown during startup).
      return;
    }
    try {
      await worker.close();
    } catch (error: unknown) {
      new Logger(this.constructor.name).warn(
        `Worker did not close cleanly: ${errorMessage(error)}`,
      );
    }
  }
}
