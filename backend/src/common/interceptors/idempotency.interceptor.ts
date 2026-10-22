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
import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import { from, Observable, of } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { RedisService } from '../../redis/redis.service';
import { errorMessage } from '../utils/error.util';

/** The header a client sends to make a write safe to repeat. */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

/** Methods that change state. A GET is already safe to repeat. */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** UUIDs, hex, base64url: anything else is a client bug or a probe. */
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/** What is stored under a key. */
type Entry =
  | { state: 'pending'; fingerprint: string }
  | { state: 'done'; fingerprint: string; body: unknown };

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
 * - Without the header, or without Redis, a request runs exactly as before.
 *   Installed apps that predate this send no key and are unaffected.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  /** How long a completed result can be replayed. */
  static readonly TTL_SECONDS = 24 * 60 * 60;
  /**
   * How long a claim lives before its request finishes. Short, so a process
   * that dies mid-request (a deploy, an OOM) frees the key within a minute
   * instead of refusing that submission for a day.
   */
  static readonly PENDING_TTL_SECONDS = 60;
  /** How long a repeat waits for the first request to finish. */
  static readonly WAIT_MS = 10_000;
  static readonly POLL_MS = 200;
  /** Results larger than this are not kept; a repeat then gets a 409. */
  static readonly MAX_BODY_BYTES = 256 * 1024;

  constructor(private readonly redis: RedisService) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: { id?: string } }>();
    const response = http.getResponse<Response>();

    if (!WRITE_METHODS.has(request.method)) return next.handle();
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
      : `ip:${request.ip ?? 'unknown'}`;
    const redisKey = `idem:v1:${scope}:${request.method}:${routePath}:${key}`;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(request.body ?? null))
      .digest('hex');

    return from(this.claim(redisKey, fingerprint)).pipe(
      mergeMap((claim) => {
        if (claim.kind === 'replay') {
          response.setHeader('Idempotent-Replayed', 'true');
          return of(claim.body);
        }
        if (claim.kind === 'bypass') return next.handle();
        return next.handle().pipe(
          mergeMap((body) => from(this.complete(redisKey, fingerprint, body))),
          catchError((err: unknown) =>
            from(this.release(redisKey)).pipe(
              mergeMap(() => {
                throw err;
              }),
            ),
          ),
        );
      }),
    );
  }

  /**
   * Takes the key, or reports what an earlier request with it left behind.
   * `run`: this request owns the key. `replay`: return the stored result.
   * `bypass`: Redis failed, so run without protection rather than refuse.
   */
  private async claim(
    redisKey: string,
    fingerprint: string,
  ): Promise<
    { kind: 'run' } | { kind: 'bypass' } | { kind: 'replay'; body: unknown }
  > {
    const client = this.redis.getClient();
    if (!client) return { kind: 'bypass' };
    const pending: Entry = { state: 'pending', fingerprint };
    try {
      const taken = await client.set(
        redisKey,
        JSON.stringify(pending),
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
            JSON.stringify(pending),
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
        }
        if (Date.now() >= deadline) {
          throw new ConflictException(
            'A request with this Idempotency-Key is still being processed',
          );
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

  /** Stores the result for replay, then passes it on unchanged. */
  private async complete(
    redisKey: string,
    fingerprint: string,
    body: unknown,
  ): Promise<unknown> {
    const client = this.redis.getClient();
    if (!client) return body;
    try {
      const done: Entry = { state: 'done', fingerprint, body: body ?? null };
      const serialized = JSON.stringify(done);
      if (serialized.length > IdempotencyInterceptor.MAX_BODY_BYTES) {
        // Too large to keep: free the key rather than leave it pending.
        await client.del(redisKey);
        return body;
      }
      await client.set(
        redisKey,
        serialized,
        'EX',
        IdempotencyInterceptor.TTL_SECONDS,
      );
    } catch (err: unknown) {
      this.logger.warn(`Idempotency result not stored: ${errorMessage(err)}`);
    }
    return body;
  }

  /** Frees the key after a failed write, so a retry is not refused. */
  private async release(redisKey: string): Promise<void> {
    try {
      await this.redis.getClient()?.del(redisKey);
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
      (value.state === 'pending' || value.state === 'done')
    ) {
      return value as Entry;
    }
  } catch {
    // Unreadable entry: treated as absent.
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
