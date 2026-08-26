import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

/**
 * Tracks how many Socket.IO clients are currently connected.
 *
 * The realtime gateway registers its server here once it is up. Reading the
 * count from the live server rather than keeping a running tally of connect and
 * disconnect events is deliberate: a missed disconnect (a dropped connection, a
 * crashed worker) makes a counter drift upward forever, and a connection
 * gauge that only ever climbs is worse than no gauge at all.
 *
 * The manual counter is kept only as a fallback for when no server has been
 * registered, so the metric degrades to zero rather than throwing.
 */
@Injectable()
export class SocketMetricsCollector {
  private readonly logger = new Logger(SocketMetricsCollector.name);

  private server: Server | null = null;
  private fallbackCount = 0;

  /** Called by the realtime gateway once Socket.IO has initialised. */
  registerServer(server: Server): void {
    this.server = server;
    this.logger.log('monitoring.socket_server_registered');
  }

  /** Fallback bookkeeping, used only while no server is registered. */
  onConnect(): void {
    this.fallbackCount += 1;
  }

  onDisconnect(): void {
    this.fallbackCount = Math.max(0, this.fallbackCount - 1);
  }

  getConnectionCount(): number {
    const engineCount = (this.server as any)?.engine?.clientsCount;
    if (typeof engineCount === 'number') return engineCount;

    const socketCount = this.server?.sockets?.sockets?.size;
    if (typeof socketCount === 'number') return socketCount;

    return this.fallbackCount;
  }
}
