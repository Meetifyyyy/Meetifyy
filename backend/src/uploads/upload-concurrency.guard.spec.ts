import { EventEmitter } from 'node:events';
import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UploadsController } from './uploads.controller';
import {
  UPLOAD_BUSY_RETRY_AFTER_SECONDS,
  UPLOAD_MAX_CONCURRENT,
  UploadConcurrencyGuard,
} from './upload-concurrency.guard';
import { JwtGuard } from '../common/guards/jwt.guard';
import { RateLimitPolicyGuard } from '../common/rate-limit/rate-limit-policy.guard';
import { RATE_LIMIT_POLICIES_KEY } from '../common/rate-limit/rate-limit.decorator';
import { stub } from '../common/testing/stub';

/** A response that records headers and lets a test fire `close`. */
function fakeResponse() {
  const emitter = new EventEmitter();
  const headers: Record<string, string> = {};
  return {
    emitter,
    headers,
    res: {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
      once: (event: string, listener: () => void) => {
        emitter.once(event, listener);
      },
    },
  };
}

function contextFor(res: ReturnType<typeof fakeResponse>['res']) {
  return stub<ExecutionContext>({
    switchToHttp: () => ({ getResponse: () => res }),
  });
}

/**
 * POST /api/media/upload buffers up to 50 MB per request in memory before the
 * handler runs, and used to have neither a route budget nor a ceiling on how
 * many of those buffers a process held at once.
 */
describe('POST /api/media/upload protection', () => {
  const upload = UploadsController.prototype.upload;

  describe('route metadata', () => {
    it('declares a per-user policy and mounts the guard that enforces it', () => {
      expect(
        new Reflector().get<string[]>(RATE_LIMIT_POLICIES_KEY, upload),
      ).toEqual(['media.presigned']);
      expect(Reflect.getMetadata('__guards__', upload)).toContain(
        RateLimitPolicyGuard,
      );
    });

    it('runs authentication, then the budget, then the concurrency cap', () => {
      // JwtGuard supplies the user the policy keys on; the cap comes last so an
      // anonymous or over-budget caller never takes a slot.
      expect(Reflect.getMetadata('__guards__', upload)).toEqual([
        JwtGuard,
        RateLimitPolicyGuard,
        UploadConcurrencyGuard,
      ]);
    });
  });

  describe('UploadConcurrencyGuard', () => {
    it('admits up to the cap and refuses the next with 503, Retry-After and no-store', () => {
      const guard = new UploadConcurrencyGuard();
      for (let i = 0; i < UPLOAD_MAX_CONCURRENT; i += 1) {
        expect(guard.canActivate(contextFor(fakeResponse().res))).toBe(true);
      }

      const overflow = fakeResponse();
      let thrown: unknown;
      try {
        guard.canActivate(contextFor(overflow.res));
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ServiceUnavailableException);
      expect((thrown as ServiceUnavailableException).getStatus()).toBe(503);
      expect(overflow.headers['Retry-After']).toBe(
        String(UPLOAD_BUSY_RETRY_AFTER_SECONDS),
      );
      expect(overflow.headers['Cache-Control']).toBe('no-store');
    });

    it('frees a slot when a response closes, however it ended', () => {
      const guard = new UploadConcurrencyGuard();
      const open = Array.from({ length: UPLOAD_MAX_CONCURRENT }, () => {
        const r = fakeResponse();
        guard.canActivate(contextFor(r.res));
        return r;
      });
      expect(() => guard.canActivate(contextFor(fakeResponse().res))).toThrow(
        ServiceUnavailableException,
      );

      // One upload finishes, another is abandoned by its client: both emit close.
      open[0].emitter.emit('close');
      expect(guard.canActivate(contextFor(fakeResponse().res))).toBe(true);
    });

    it('releases a slot only once even if close is emitted twice', () => {
      const guard = new UploadConcurrencyGuard();
      const open = Array.from({ length: UPLOAD_MAX_CONCURRENT }, () => {
        const r = fakeResponse();
        guard.canActivate(contextFor(r.res));
        return r;
      });
      open[0].emitter.emit('close');
      open[0].emitter.emit('close');

      // One slot is free, not two.
      expect(guard.canActivate(contextFor(fakeResponse().res))).toBe(true);
      expect(() => guard.canActivate(contextFor(fakeResponse().res))).toThrow(
        ServiceUnavailableException,
      );
    });

    it('does not count a refused request against the cap', () => {
      const guard = new UploadConcurrencyGuard();
      const open = Array.from({ length: UPLOAD_MAX_CONCURRENT }, () => {
        const r = fakeResponse();
        guard.canActivate(contextFor(r.res));
        return r;
      });
      for (let i = 0; i < 20; i += 1) {
        expect(() => guard.canActivate(contextFor(fakeResponse().res))).toThrow(
          ServiceUnavailableException,
        );
      }
      open[0].emitter.emit('close');
      expect(guard.canActivate(contextFor(fakeResponse().res))).toBe(true);
    });
  });
});
