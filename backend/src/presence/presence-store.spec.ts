import { randomUUID } from 'crypto';
import { MemoryPresenceStore } from './presence-store';
import { presenceStoreContract } from './testing/presence-store-contract';

/** The Redis scripts run the same contract in presence.redis.spec.ts. */
describe('MemoryPresenceStore', () => {
  presenceStoreContract(() => new MemoryPresenceStore(), randomUUID);
});
