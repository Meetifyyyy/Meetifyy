import { RealtimeGateway } from '../realtime.gateway';
import type { AppSocket } from '../socket-types';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { MessagesService } from '../../messages/messages.service';
import type { PresenceService } from '../../presence/presence.service';
import type { InstantMatchService } from '../../instant-match/instant-match.service';
import type { InstantMatchRateLimiter } from '../../instant-match/instant-match.rate-limiter';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RedisService } from '../../redis/redis.service';
import type { ActivityAuthorizationService } from '../../activities/activity-authorization.service';
import type { CommunitiesService } from '../../communities/communities.service';
import type { BlocksService } from '../../users/blocks.service';
import type { VerificationAccessService } from '../../common/verification/verification-access.service';
import type { StudentYearPolicyService } from '../../common/student-year/student-year-policy.service';
import type { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import type { LegalConsentService } from '../../common/legal/legal-consent.service';
import type { JwtGuard } from '../../common/guards/jwt.guard';
import { stub, type Stub } from '../../common/testing/stub';
import { createVerificationAccessMock } from '../../common/verification/testing/verification-access.mock';
import { createStudentYearPolicyMock } from '../../common/student-year/testing/student-year-policy.mock';
import { createLegalConsentMock } from '../../common/legal/testing/legal-consent.mock';
import { allowAllRateLimit } from '../../common/rate-limit/testing/rate-limit.mock';

/**
 * The gateway's fifteen constructor dependencies, by name. Any left out is an
 * empty stand-in, except the four shared policies, which default to their
 * permissive testing mocks (verified, same cohort, unlimited, consented).
 */
export interface GatewayDependencies {
  supabase?: Stub<SupabaseService>;
  messages?: Stub<MessagesService>;
  presence?: Stub<PresenceService>;
  instantMatch?: Stub<InstantMatchService>;
  instantMatchLimiter?: Stub<InstantMatchRateLimiter>;
  prisma?: Stub<PrismaService>;
  redis?: Stub<RedisService>;
  activityPolicy?: Stub<ActivityAuthorizationService>;
  communities?: Stub<CommunitiesService>;
  blocks?: Stub<BlocksService>;
  verificationAccess?: VerificationAccessService;
  studentYearPolicy?: StudentYearPolicyService;
  rateLimit?: RateLimitService;
  legalConsent?: LegalConsentService;
  jwtGuard?: Stub<JwtGuard>;
}

export function buildGateway(deps: GatewayDependencies = {}): RealtimeGateway {
  return new RealtimeGateway(
    stub<SupabaseService>(deps.supabase),
    stub<MessagesService>(deps.messages),
    stub<PresenceService>(deps.presence),
    stub<InstantMatchService>(deps.instantMatch),
    stub<InstantMatchRateLimiter>(deps.instantMatchLimiter),
    stub<PrismaService>(deps.prisma),
    stub<RedisService>(deps.redis),
    stub<ActivityAuthorizationService>(deps.activityPolicy),
    stub<CommunitiesService>(deps.communities),
    stub<BlocksService>(deps.blocks),
    deps.verificationAccess ?? createVerificationAccessMock(),
    deps.studentYearPolicy ?? createStudentYearPolicyMock(),
    deps.rateLimit ?? allowAllRateLimit(),
    deps.legalConsent ?? createLegalConsentMock(),
    stub<JwtGuard>(deps.jwtGuard),
  );
}

/**
 * A socket for handler tests: the members the test supplies (typically jest
 * mocks for join/emit/disconnect), typed as a real AppSocket so the handler
 * accepts it and the test can read what the handler wrote to `data`.
 */
export function fakeSocket<M extends Stub<AppSocket>>(
  members: M,
): AppSocket & M {
  return members as unknown as AppSocket & M;
}
