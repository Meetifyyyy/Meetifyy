import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'idempotent';

/**
 * Marks a create route as safe to retry with an `Idempotency-Key`.
 *
 * Only routes carrying this get the IdempotencyInterceptor: a create the
 * clients key per submission (posts, comments, communities, groups,
 * activities, discussion messages, support requests). It is opt-in because
 * every keyed request stores its result in Redis, which runs `noeviction`;
 * accepting keys on any write would let one account fill it and stop the job
 * queues with it.
 */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);
