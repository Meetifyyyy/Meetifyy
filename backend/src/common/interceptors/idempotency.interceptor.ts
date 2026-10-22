import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { createHash, randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import { from, Observable, of } from 'rxjs';
import { catchError, finalize, mergeMap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import { RedisService } from '../../redis/redis.service';
import { IDEMPOTENT_KEY } from '../decorators/idempotent.decorator';
import { clientIp } from '../rate-limit/client-ip.util';
import { errorMessage } from '../utils/error.util';

/** The header a client sends to make a write safe to repeat. */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

/** Methods that change state. A GET is already safe to repeat. */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** UUIDs, hex, base64url: anything else is a client bug or a probe. */
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/** What is stored under a key. */
type Entry =
  | { state: 'pending'; fingerprint: string; token?: string }
  | { state: 'done'; fingerprint: string; body: unknown }
  // The write committed but its result was too large to keep. Holds only the
  // id (when the body had one), so a repeat can say what was created.
  | { state: 'done-unreplayable'; fingerprint: string; resourceId?: string };

/*
 * Each claim carries a random token in its pending entry, and the exact entry
 * string is what these scripts compare. A request may only refresh, release or
 * complete the key while the stored entry is still its own claim: if its claim
 * expired and a retry claimed again, the first request must not delete or
 * overwrite the second one's.
 */

/** KEYS[1] key; ARGV[1] own pending entry. Deletes only our own claim. */
export const RELEASE_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";

/** KEYS[1] key; ARGV[1] own pending entry, ARGV[2] result, ARGV[3] TTL. */
export const COMPLETE_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3]) return 1 end return 0";

/** KEYS[1] key; ARGV[1] own pending entry, ARGV[2] TTL. Extends our claim. */
export const REFRESH_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('EXPIRE', KEYS[1], ARGV[2]) end return 0";

/**
 * Makes a write that carries an `Idempotency-Key` happen at most once.
 *
 * A write whose response is lost is otherwise impossible to retry safely. The
 * client's failover re-sends a POST whose connection reset after the server had
 * committed it; a user who sees a timeout taps "Post" again. Both used to
 * create a second post, comment, community, group chat, activity, discussion
 * message or support ticket. Here, the first request with a key does the work
 * and its result is kept; a repeat of the same key gets that result back.
 *
 * - Keys are scoped to the caller (user id, or client IP when signed out) and
 *   to the method and path, so one user's key can never return another
 *   user's result or another route's.
 * - The same key with a different body is refused (422): it is a client bug,
 *   and replaying the first body for it would hide that.
 * - A repeat that arrives while the first is still running waits for it, then
 *   replays; past `WAIT_MS` it is refused (409) rather than run twice.
 * - A write that FAILS releases its key, so a retry runs for real.
 * - A write that SUCCEEDS but returns more than MAX_BODY_BYTES keeps a small
 *   marker, and a repeat is answered 409 IDEMPOTENCY_ALREADY_PROCESSED. Freeing
 *   the key there let the retry run the committed write a second time.
 * - A claim is refreshed while its handler runs, so a slow write keeps it; a
 *   crashed process stops refreshing and its claim expires within a minute.
 * - Without the header, or without Redis, a request runs exactly as before.
 *   Installed apps that predate this send no key and are unaffected.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  /**
   * How long a completed result can be replayed. An hour covers every retry a
   * client makes (failover, timeout, the user tapping again); a day only kept
   * more in a Redis that never evicts.
   */
  static readonly TTL_SECONDS = 60 * 60;
  /**
   * How long a claim lives before its request finishes. Short, so a process
   * that dies mid-request (a deploy, an OOM) frees the key within a minute
   * instead of refusing that submission for a day.
   */
  static readonly PENDING_TTL_SECONDS = 60;
  /** How long a repeat waits for the first request to finish. */
  static readonly WAIT_MS = 10_000;
  static readonly POLL_MS = 200;
  /**
   * Results larger than this are not kept whole. A created post or comment is
   * a few kilobytes (a post with six images and a poll is well under this);
   * this bounds Redis memory. A bigger result leaves a small "already
   * processed" marker instead, never a freed key: see `complete`.
   */
  static readonly MAX_BODY_BYTES = 64 * 1024;

  constructor(
    private readonly redis: RedisService,
    private readonly reflector: Reflector,
  ) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: { id?: string } }>();
    const response = http.getResponse<Response>();

    if (!WRITE_METHODS.has(request.method)) return next.handle();
    // Opt-in per route (@Idempotent()): see the decorator for why not global.
    const optedIn = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!optedIn) return next.handle();
    // A handler that touches the response cannot be replayed from a stored
    // body. Without passthrough it ignores what an interceptor returns, so the
    // repeat would hang (the direct media upload). With passthrough it sets
    // cookies and headers: sign-in, refresh, adopt and sign-out, whose replay
    // would answer "signed in" with no session cookie, and whose body carries
    // the installed app's tokens, which must never sit in Redis. Auth paths
    // are also skipped by name, in case one stops taking `@Res`.
    if (touchesResponse(context)) return next.handle();
    const routePath = `${request.baseUrl ?? ''}${request.path}`;
    if (AUTH_PATH.test(routePath)) return next.handle();
    const raw = request.headers[IDEMPOTENCY_HEADER];
    const key = typeof raw === 'string' ? raw.trim() : '';
    if (!key) return next.handle();
    if (!KEY_PATTERN.test(key)) {
      throw new UnprocessableEntityException('Invalid Idempotency-Key');
    }

    const client = this.redis.getClient();
    if (!client) return next.handle();

    const scope = request.user?.id
      ? `u:${request.user.id}`
      : `ip:${clientIp(request) || 'unknown'}`;
    const redisKey = `idem:v1:${scope}:${request.method}:${routePath}:${key}`;
    // Body AND query: a route that takes its input from the query string
    // (starting a conversation reads `?userIds=`) must not replay one
    // request's result for a different one under a reused key.
    const body: unknown = request.body ?? null;
    const query: unknown = request.query ?? {};
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ body, query }))
      .digest('hex');

    const pending: Entry = {
      state: 'pending',
      fingerprint,
      token: randomBytes(16).toString('hex'),
    };
    const claimValue = JSON.stringify(pending);

    return from(this.claim(redisKey, fingerprint, claimValue)).pipe(
      mergeMap((claim) => {
        if (claim.kind === 'replay') {
          response.setHeader('Idempotent-Replayed', 'true');
          return of(claim.body);
        }
        if (claim.kind === 'bypass') return next.handle();
        const timer = setInterval(
          () => void this.refresh(redisKey, claimValue),
          (IdempotencyInterceptor.PENDING_TTL_SECONDS * 1000) / 3,
        );
        timer.unref?.();
        return next.handle().pipe(
          mergeMap((body) =>
            from(this.complete(redisKey, fingerprint, claimValue, body)),
          ),
          catchError((err: unknown) =>
            from(this.release(redisKey, claimValue)).pipe(
              mergeMap(() => {
                throw err;
              }),
            ),
          ),
          finalize(() => clearInterval(timer)),
        );
      }),
    );
  }

  /**
   * Extends this request's claim while its handler runs. Fire-and-forget from
   * a timer, so it never throws; it does nothing once the claim is not ours.
   */
  private async refresh(redisKey: string, claimValue: string): Promise<void> {
    try {
      await this.redis
        .getClient()
        ?.eval(
          REFRESH_SCRIPT,
          1,
          redisKey,
          claimValue,
          IdempotencyInterceptor.PENDING_TTL_SECONDS,
        );
    } catch (err: unknown) {
      this.logger.warn(`Idempotency claim not refreshed: ${errorMessage(err)}`);
    }
  }

  /**
   * Takes the key, or reports what an earlier request with it left behind.
   * `run`: this request owns the key. `replay`: return the stored result.
   * `bypass`: Redis failed, so run without protection rather than refuse.
   */
  private async claim(
    redisKey: string,
    fingerprint: string,
    claimValue: string,
  ): Promise<
    { kind: 'run' } | { kind: 'bypass' } | { kind: 'replay'; body: unknown }
  > {
    const client = this.redis.getClient();
    if (!client) return { kind: 'bypass' };
    try {
      const taken = await client.set(
        redisKey,
        claimValue,
        'EX',
        IdempotencyInterceptor.PENDING_TTL_SECONDS,
        'NX',
      );
      if (taken === 'OK') return { kind: 'run' };

      const deadline = Date.now() + IdempotencyInterceptor.WAIT_MS;
      for (;;) {
        const raw = await client.get(redisKey);
        const entry = parseEntry(raw);
        if (raw !== null && !entry) {
          // Unreadable: nothing can be replayed from it, so drop it.
          await client.del(redisKey);
        }
        // Released (the first attempt failed), expired, or dropped: run.
        if (!entry) {
          const retaken = await client.set(
            redisKey,
            claimValue,
            'EX',
            IdempotencyInterceptor.PENDING_TTL_SECONDS,
            'NX',
          );
          if (retaken === 'OK') return { kind: 'run' };
        } else {
          if (entry.fingerprint !== fingerprint) {
            throw new UnprocessableEntityException(
              'Idempotency-Key was already used for a different request',
            );
          }
          if (entry.state === 'done') {
            return { kind: 'replay', body: entry.body };
          }
          if (entry.state === 'done-unreplayable') {
            // Terminal: the first request committed, so a repeat must not
            // run again. Waiting would only end in IN_PROGRESS.
            throw new ConflictException({
              code: 'IDEMPOTENCY_ALREADY_PROCESSED',
              message:
                'A request with this Idempotency-Key was already processed',
              ...(entry.resourceId ? { id: entry.resourceId } : {}),
            });
          }
        }
        if (Date.now() >= deadline) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_IN_PROGRESS',
            message:
              'A request with this Idempotency-Key is still being processed',
          });
        }
        await sleep(IdempotencyInterceptor.POLL_MS);
      }
    } catch (err: unknown) {
      if (
        err instanceof UnprocessableEntityException ||
        err instanceof ConflictException
      ) {
        throw err;
      }
      this.logger.warn(`Idempotency check skipped: ${errorMessage(err)}`);
      return { kind: 'bypass' };
    }
  }

  /**
   * Stores the result for replay, then passes it on unchanged. Only replaces
   * this request's own claim: never another request's claim or result.
   */
  private async complete(
    redisKey: string,
    fingerprint: string,
    claimValue: string,
    body: unknown,
  ): Promise<unknown> {
    const client = this.redis.getClient();
    if (!client) return body;
    try {
      const done: Entry = { state: 'done', fingerprint, body: body ?? null };
      let serialized = JSON.stringify(done);
      if (serialized.length > IdempotencyInterceptor.MAX_BODY_BYTES) {
        // Too large to replay, but the write HAS committed. Releasing the key
        // (as this used to) let a retry run it again: a duplicate. Keep a
        // small marker instead; a repeat gets 409 ALREADY_PROCESSED, with the
        // id when the result had one, rather than a second write.
        const marker: Entry = {
          state: 'done-unreplayable',
          fingerprint,
          resourceId: resourceIdOf(body),
        };
        serialized = JSON.stringify(marker);
      }
      await client.eval(
        COMPLETE_SCRIPT,
        1,
        redisKey,
        claimValue,
        serialized,
        IdempotencyInterceptor.TTL_SECONDS,
      );
    } catch (err: unknown) {
      this.logger.warn(`Idempotency result not stored: ${errorMessage(err)}`);
    }
    return body;
  }

  /**
   * Frees the key after a failed write, so a retry is not refused. Only this
   * request's own claim: a newer claimant's key is left alone.
   */
  private async release(redisKey: string, claimValue: string): Promise<void> {
    try {
      await this.redis
        .getClient()
        ?.eval(RELEASE_SCRIPT, 1, redisKey, claimValue);
    } catch (err: unknown) {
      this.logger.warn(`Idempotency key not released: ${errorMessage(err)}`);
    }
  }
}

/** `/api/auth/...`, `/api/admin/auth/...` and the like: never replayed. */
const AUTH_PATH = /(^|\/)auth(\/|$)/;

function touchesResponse(context: ExecutionContext): boolean {
  const target = context.getClass();
  const handler = context.getHandler().name;
  const args: unknown = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    target,
    handler,
  );
  if (typeof args !== 'object' || args === null) return false;
  const usesResponse = Object.keys(args).some(
    (k) => k.split(':')[0] === String(RouteParamtypes.RESPONSE),
  );
  return usesResponse;
}

function parseEntry(raw: string | null): Entry | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === 'object' &&
      value !== null &&
      'state' in value &&
      'fingerprint' in value &&
      typeof value.fingerprint === 'string' &&
      (value.state === 'pending' ||
        value.state === 'done' ||
        value.state === 'done-unreplayable')
    ) {
      return value as Entry;
    }
  } catch {
    // Unreadable entry: treated as absent.
  }
  return null;
}

/** The `id` of a result, when it has a plain string one. */
function resourceIdOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('id' in body)) {
    return undefined;
  }
  const id = body.id;
  return typeof id === 'string' && id.length <= 128 ? id : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
