import type { DefaultEventsMap, Server, Socket } from 'socket.io';
import type { SocketIdentity } from '../common/types/authenticated-request';

/**
 * The gateway's socket and server, with `socket.data` typed as the identity
 * the handshake attaches. Event maps keep Socket.IO's defaults; only the data
 * store is typed, since that is what authorization reads.
 */
export type AppSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SocketIdentity
>;

export type AppServer = Server<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SocketIdentity
>;
