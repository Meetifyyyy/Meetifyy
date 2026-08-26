import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ActivityVisibility, CrewActivityStatus, Prisma } from '@prisma/client';

/**
 * Centralised activity access policy.
 *
 * Visibility is an AUTHORIZATION BOUNDARY, not a presentation preference: every
 * REST endpoint, discovery query, realtime fan-out and invitation flow resolves
 * access through this one service so the rules cannot drift between surfaces.
 *
 *   PUBLIC       ("Anyone")  – discoverable, viewable and joinable by everyone.
 *   COLLEGE_ONLY ("College") – host's college only, plus explicitly invited users.
 *   PRIVATE      ("Private") – host and explicitly invited users only, never
 *                              organically discoverable.
 *
 * The policy only ever reads trusted, server-resolved data (the authenticated
 * user's id + collegeId from the DB, and the activity row itself). No client
 * supplied flag — `isInvited`, a query param, a token in the URL — participates.
 */

export interface UserAuthContext {
  id: string;
  collegeId?: string | null;
}

/** Minimal invitation shape the policy needs to judge validity. */
export interface InvitationAuthShape {
  inviteeId: string;
  status: string;
  revokedAt?: Date | string | null;
  expiresAt?: Date | string | null;
}

export interface ActivityAuthTarget {
  id: string;
  creatorId: string;
  collegeId?: string | null;
  visibility: ActivityVisibility;
  status: CrewActivityStatus;
  shareToCampus?: boolean;
  maxMembers?: number | null;
  deletedAt?: Date | null;
  /**
   * Membership rows. May be a partial set (e.g. the first 5 members of a feed
   * card) — the policy therefore NEVER treats an absent row as proof of
   * non-membership for allow/deny; callers that need membership to grant access
   * pass either the caller's own row or an explicit `isMember` hint.
   */
  members?: Array<{ userId: string; status: string }>;
  invitations?: InvitationAuthShape[];
  _count?: { members: number };
}

export type ActivityAccessCode =
  | 'ALLOWED'
  | 'AUTH_REQUIRED'
  | 'NOT_FOUND'
  | 'BLOCKED'
  | 'PRIVATE'
  | 'COLLEGE_RESTRICTED'
  | 'FULL'
  | 'NOT_OPEN'
  | 'CANCELLED'
  | 'ALREADY_STARTED'
  | 'PAST_MEMBER';

export interface AuthDecision {
  allowed: boolean;
  reason?: string;
  code?: ActivityAccessCode;
}

/** Copy shown to a user who is denied — deliberately free of activity details. */
export const ACCESS_DENIED_MESSAGES: Record<string, string> = {
  COLLEGE_RESTRICTED:
    "You can't access this activity because it's from another college.",
  PRIVATE: 'This activity is private and you do not have access.',
};

const ALLOW: AuthDecision = { allowed: true, code: 'ALLOWED' };

@Injectable()
export class ActivityAuthorizationService {
  // ── Invitation validity ────────────────────────────────────────────────────

  /**
   * An invitation grants access only while it is genuinely live: tied to this
   * activity row, tied to this user, still PENDING or ACCEPTED, not revoked and
   * not past its expiry.
   */
  isValidInvitation(
    invitation: InvitationAuthShape | null | undefined,
    userId: string,
  ): boolean {
    if (!invitation) return false;
    if (invitation.inviteeId !== userId) return false;
    if (invitation.status !== 'PENDING' && invitation.status !== 'ACCEPTED')
      return false;
    if (invitation.revokedAt) return false;
    if (
      invitation.expiresAt &&
      new Date(invitation.expiresAt).getTime() <= Date.now()
    )
      return false;
    return true;
  }

  hasValidInvitation(
    user: UserAuthContext | null,
    activity: ActivityAuthTarget,
  ): boolean {
    if (!user) return false;
    return Boolean(
      activity.invitations?.some((inv) => this.isValidInvitation(inv, user.id)),
    );
  }

  /**
   * Prisma `where` fragment matching only live invitations for `userId`.
   * Used to push invitation checks down into the database for list queries.
   */
  validInvitationWhere(userId: string): Prisma.ActivityInvitationWhereInput {
    return {
      inviteeId: userId,
      status: { in: ['PENDING', 'ACCEPTED'] },
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    };
  }

  // ── Relationship helpers ───────────────────────────────────────────────────

  isHost(user: UserAuthContext | null, activity: ActivityAuthTarget): boolean {
    return Boolean(user && activity.creatorId === user.id);
  }

  isMember(
    user: UserAuthContext | null,
    activity: ActivityAuthTarget,
  ): boolean {
    if (!user) return false;
    return Boolean(
      activity.members?.some(
        (m) => m.userId === user.id && m.status === 'MEMBER',
      ),
    );
  }

  /**
   * Same-college test. Both sides must be known: a user without a college, or an
   * activity whose host had no college, never satisfies a college restriction.
   */
  private isSameCollege(
    user: UserAuthContext | null,
    activity: ActivityAuthTarget,
  ): boolean {
    if (!user?.collegeId || !activity.collegeId) return false;
    return user.collegeId === activity.collegeId;
  }

  // ── 1. VIEW ────────────────────────────────────────────────────────────────

  /**
   * Can this user open the activity (detail endpoint, direct link, discussion,
   * attendee list, realtime room)?
   *
   *   host                                        → allow
   *   PUBLIC                                      → allow
   *   COLLEGE_ONLY → same college | valid invite | member → allow, else deny
   *   PRIVATE      → valid invite | member                → allow, else deny
   */
  canView(
    user: UserAuthContext | null,
    activity: ActivityAuthTarget,
  ): AuthDecision {
    if (activity.visibility === ActivityVisibility.PUBLIC) return ALLOW;

    // Every restricted mode requires an identified caller.
    if (!user) {
      return {
        allowed: false,
        reason:
          ACCESS_DENIED_MESSAGES[
            activity.visibility === ActivityVisibility.PRIVATE
              ? 'PRIVATE'
              : 'COLLEGE_RESTRICTED'
          ],
        code:
          activity.visibility === ActivityVisibility.PRIVATE
            ? 'PRIVATE'
            : 'COLLEGE_RESTRICTED',
      };
    }

    if (this.isHost(user, activity)) return ALLOW;
    if (this.isMember(user, activity)) return ALLOW;
    if (this.hasValidInvitation(user, activity)) return ALLOW;

    if (activity.visibility === ActivityVisibility.PRIVATE) {
      return {
        allowed: false,
        reason: ACCESS_DENIED_MESSAGES.PRIVATE,
        code: 'PRIVATE',
      };
    }

    // COLLEGE_ONLY
    if (this.isSameCollege(user, activity)) return ALLOW;
    return {
      allowed: false,
      reason: ACCESS_DENIED_MESSAGES.COLLEGE_RESTRICTED,
      code: 'COLLEGE_RESTRICTED',
    };
  }

  /**
   * Throwing wrapper for controller/service call sites.
   *
   * A PRIVATE activity answers 404, not 403. The distinction is deliberate:
   * "forbidden" confirms that the id names a real activity, which is itself a
   * disclosure for something whose whole point is that uninvited people cannot
   * learn it exists. To a stranger holding a copied link, a private activity is
   * indistinguishable from a typo. COLLEGE_ONLY keeps its 403 — its existence
   * is already implied by the invite/share flows inside a college, and the
   * explanatory copy ("ask the host for an invite") is what makes the denial
   * actionable rather than a dead end.
   *
   * Either way the thrown body carries a code and generic copy only — never the
   * title, description, location, host or attendees.
   */
  assertCanView(
    user: UserAuthContext | null,
    activity: ActivityAuthTarget,
  ): void {
    const decision = this.canView(user, activity);
    if (decision.allowed) return;

    if (decision.code === 'PRIVATE') {
      throw new NotFoundException('Activity not found');
    }

    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      code: decision.code,
      message: decision.reason,
    });
  }

  // ── 2. DISCOVER ────────────────────────────────────────────────────────────

  /**
   * Organic discovery eligibility: feeds, Crew sections, search, recommendations,
   * suggestions. Stricter than {@link canView} — PRIVATE activities are never
   * organically surfaced; they reach their host and invitees through the
   * personal "My activities" / invitation lists instead.
   */
  canDiscover(
    user: UserAuthContext | null,
    activity: ActivityAuthTarget,
  ): boolean {
    if (activity.deletedAt) return false;
    if (activity.visibility === ActivityVisibility.PRIVATE) return false;
    if (activity.visibility === ActivityVisibility.PUBLIC) return true;

    // COLLEGE_ONLY
    if (!user) return false;
    if (this.isHost(user, activity)) return true;
    if (this.isMember(user, activity)) return true;
    if (this.isSameCollege(user, activity)) return true;
    return this.hasValidInvitation(user, activity);
  }

  // ── 3. JOIN ────────────────────────────────────────────────────────────────

  /**
   * Join authorization. Runs the same visibility gate as {@link canView} first —
   * a user who may not see an activity may never join it — and then the ordinary
   * activity rules (status, capacity).
   */
  canJoin(
    user: UserAuthContext | null,
    activity: ActivityAuthTarget,
  ): AuthDecision {
    if (!user) {
      return {
        allowed: false,
        reason: 'Authentication required',
        code: 'AUTH_REQUIRED',
      };
    }

    if (this.isHost(user, activity)) return ALLOW;
    if (this.isMember(user, activity)) return ALLOW;

    // Visibility gate — identical rules to viewing, so there is no state in which
    // a user is denied the page but permitted the join API.
    const viewDecision = this.canView(user, activity);
    if (!viewDecision.allowed) return viewDecision;

    if (activity.deletedAt) {
      return {
        allowed: false,
        reason: 'Activity not found',
        code: 'NOT_FOUND',
      };
    }
    if (activity.status === CrewActivityStatus.CANCELLED) {
      return {
        allowed: false,
        reason: 'This activity has been cancelled',
        code: 'CANCELLED',
      };
    }
    if (activity.status !== CrewActivityStatus.OPEN) {
      return {
        allowed: false,
        reason: 'Activity is not open for joining',
        code: 'NOT_OPEN',
      };
    }

    const currentMemberCount =
      activity._count?.members ??
      activity.members?.filter((m) => m.status === 'MEMBER').length ??
      0;
    if (activity.maxMembers && currentMemberCount >= activity.maxMembers) {
      return { allowed: false, reason: 'Activity is full', code: 'FULL' };
    }

    return ALLOW;
  }

  // ── 4. MANAGE ──────────────────────────────────────────────────────────────

  /** Edit / cancel / end / invite / inspect invitation state. Host only. */
  canManage(
    user: UserAuthContext | null,
    activity: ActivityAuthTarget,
  ): boolean {
    return this.isHost(user, activity);
  }

  assertCanManage(
    user: UserAuthContext | null,
    activity: ActivityAuthTarget,
  ): void {
    if (!this.canManage(user, activity)) {
      // Deliberately a 404: a non-host must not learn that the id exists.
      throw new NotFoundException('Activity not found or you are not the host');
    }
  }

  // ── 5. Query-layer filters ─────────────────────────────────────────────────

  /**
   * `where` fragment restricting a query to activities the viewer may ORGANICALLY
   * DISCOVER. Applied at the database layer so restricted rows are never fetched
   * (and therefore can never leak through pagination, caching or a serializer).
   *
   * Combine with `AND` so it cannot be widened by other conditions:
   *   where: { AND: [ { ...filters }, policy.discoveryWhere(user) ] }
   */
  discoveryWhere(user: UserAuthContext | null): Prisma.CrewActivityWhereInput {
    if (!user) {
      return { visibility: ActivityVisibility.PUBLIC };
    }

    const clauses: Prisma.CrewActivityWhereInput[] = [
      { visibility: ActivityVisibility.PUBLIC },
      // Own restricted activities stay visible to their host.
      { creatorId: user.id, visibility: ActivityVisibility.COLLEGE_ONLY },
      // Invited-from-another-college override.
      {
        visibility: ActivityVisibility.COLLEGE_ONLY,
        invitations: { some: this.validInvitationWhere(user.id) },
      },
      // Already a participant.
      {
        visibility: ActivityVisibility.COLLEGE_ONLY,
        members: { some: { userId: user.id, status: 'MEMBER' } },
      },
    ];

    if (user.collegeId) {
      clauses.push({
        visibility: ActivityVisibility.COLLEGE_ONLY,
        collegeId: user.collegeId,
      });
    }

    return { OR: clauses };
  }

  /**
   * The subset of {@link discoveryWhere} that depends ONLY on the viewer's
   * college — never on their identity, memberships or invitations.
   *
   * This is what a page CACHED AND SHARED between viewers must be built from.
   * The personal clauses in `discoveryWhere` can admit a COLLEGE_ONLY activity
   * belonging to a different college (one the viewer hosts, joined, or was
   * invited to); writing such a row into a page keyed by college would hand it
   * to every other member of that college, who are not authorized to see it.
   * Restricting shareable pages to college-derived clauses makes the cached page
   * correct for every viewer with the same audience tag.
   */
  sharedAudienceWhere(
    user: UserAuthContext | null,
  ): Prisma.CrewActivityWhereInput {
    if (!user?.collegeId) {
      return { visibility: ActivityVisibility.PUBLIC };
    }
    return {
      OR: [
        { visibility: ActivityVisibility.PUBLIC },
        {
          visibility: ActivityVisibility.COLLEGE_ONLY,
          collegeId: user.collegeId,
        },
      ],
    };
  }

  /**
   * `where` fragment restricting a query to activities the viewer may VIEW.
   * Wider than {@link discoveryWhere}: it additionally admits PRIVATE activities
   * the viewer hosts, belongs to, or was invited to. Use it for personal lists
   * (bookmarks, "my activities") — never for organic discovery.
   */
  accessWhere(user: UserAuthContext | null): Prisma.CrewActivityWhereInput {
    if (!user) {
      return { visibility: ActivityVisibility.PUBLIC };
    }

    const discovery = this.discoveryWhere(user);
    const discoveryClauses =
      (discovery.OR as Prisma.CrewActivityWhereInput[]) ?? [discovery];

    return {
      OR: [
        ...discoveryClauses,
        { creatorId: user.id },
        { members: { some: { userId: user.id, status: 'MEMBER' } } },
        { invitations: { some: this.validInvitationWhere(user.id) } },
      ],
    };
  }
}
