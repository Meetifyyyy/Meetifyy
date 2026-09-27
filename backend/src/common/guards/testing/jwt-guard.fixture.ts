import type { ExecutionContext } from '@nestjs/common';
import type { HttpArgumentsHost } from '@nestjs/common/interfaces';
import { Reflector } from '@nestjs/core';
import { JwtGuard } from '../jwt.guard';
import { stub } from '../../testing/stub';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { SupabaseService } from '../../../supabase/supabase.service';
import type { LegalConsentService } from '../../legal/legal-consent.service';

/** A `UserSession` row, as far as the guard's liveness check reads it. */
export type SessionRow = { revoked: boolean; expiresAt: Date; userId: string };

/** The request fields the guard reads. */
export type GuardRequest = {
  cookies: Record<string, string>;
  headers: Record<string, string>;
  method: string;
};

/** An `ExecutionContext` serving one HTTP request, with no route metadata. */
export function httpContext(request: GuardRequest): ExecutionContext {
  return stub<ExecutionContext>({
    switchToHttp: jest.fn(() =>
      stub<HttpArgumentsHost>({ getRequest: jest.fn(() => request) }),
    ),
    getHandler: jest.fn(() => ({})),
    getClass: jest.fn(() => ({})),
  });
}

/**
 * A `JwtGuard` isolated to its session check.
 *
 * Token verification and the account-status gates have their own specs and
 * would otherwise need a real JWT, so both are replaced: every token resolves
 * to `user`, and the status gate passes. Supabase reports itself configured,
 * and legal consent is satisfied.
 */
export function buildSessionGuard({
  findSession,
  user,
  reflector = new Reflector(),
}: {
  /** Answers `userSession.findUnique` for a session id. */
  findSession: (id: string) => Promise<SessionRow | null>;
  /** Who every token belongs to. */
  user: { id: string; email?: string };
  reflector?: Reflector;
}): JwtGuard {
  const prisma = stub<PrismaService>({
    userSession: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        findSession(where.id),
      ),
    },
  });

  const guard = new JwtGuard(
    stub<SupabaseService>(),
    prisma,
    reflector,
    stub<LegalConsentService>({ isSatisfied: () => Promise.resolve(true) }),
  );

  Object.assign(guard, {
    validateToken: jest.fn(() => Promise.resolve(user)),
    enforceAccountStatus: jest.fn(() => Promise.resolve(undefined)),
  });
  Object.defineProperty(guard, 'supabaseService', {
    value: { isConfigured: true },
    writable: true,
  });
  return guard;
}
