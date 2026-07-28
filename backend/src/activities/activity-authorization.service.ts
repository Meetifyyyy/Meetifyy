import { Injectable } from '@nestjs/common';
import { ActivityVisibility, CrewActivityStatus } from '@prisma/client';

export interface UserAuthContext {
  id: string;
  collegeId?: string | null;
}

export interface ActivityAuthTarget {
  id: string;
  creatorId: string;
  collegeId?: string | null;
  visibility: ActivityVisibility;
  status: CrewActivityStatus;
  shareToCampus?: boolean;
  maxMembers?: number | null;
  members?: Array<{ userId: string; status: string }>;
  invitations?: Array<{ inviteeId: string; status: string }>;
  _count?: { members: number };
}

export interface AuthDecision {
  allowed: boolean;
  reason?: string;
  code?: 'ALLOWED' | 'NOT_FOUND' | 'BLOCKED' | 'PRIVATE' | 'COLLEGE_RESTRICTED' | 'FULL' | 'NOT_OPEN' | 'PAST_MEMBER';
}

@Injectable()
export class ActivityAuthorizationService {

  /**
   * 1. DISCOVERY PERMISSION (canDiscover):
   * Determines if an activity should be returned in public feeds, search results, recommendations, profiles, or campus lists.
   */
  canDiscover(user: UserAuthContext | null, activity: ActivityAuthTarget): boolean {
    // Hidden / Private activities are NEVER discoverable (except by host/creator or current members)
    if (activity.visibility === ActivityVisibility.PRIVATE) {
      if (!user) return false;
      if (activity.creatorId === user.id) return true;
      const isMember = activity.members?.some(m => m.userId === user.id && m.status === 'MEMBER');
      return Boolean(isMember);
    }

    // College Only activities: discoverable ONLY by users from the exact same college
    if (activity.visibility === ActivityVisibility.COLLEGE_ONLY || activity.shareToCampus) {
      if (!user || !user.collegeId || !activity.collegeId) return false;
      return user.collegeId === activity.collegeId;
    }

    // Public activities: discoverable by anyone
    return true;
  }

  /**
   * 2. VIEWING PERMISSION (canView):
   * Determines if a user can view activity details (e.g. via direct link /crew/:id or in UI).
   * Rules:
   * - Creator, active members, or past participants: ALWAYS allowed.
   * - Explicitly invited user: ALWAYS allowed (Invitation Override).
   * - Direct link access: Public, College Only, and Private details viewing allowed per spec.
   */
  canView(user: UserAuthContext | null, activity: ActivityAuthTarget): AuthDecision {
    if (!user) {
      return { allowed: true, code: 'ALLOWED' };
    }

    // Creator / Host
    if (activity.creatorId === user.id) {
      return { allowed: true, code: 'ALLOWED' };
    }

    // Current or Past Member (Participant)
    const isMember = activity.members?.some(m => m.userId === user.id && m.status === 'MEMBER');
    if (isMember) {
      return { allowed: true, code: 'ALLOWED' };
    }

    // Invited user (PENDING or ACCEPTED)
    const isInvited = activity.invitations?.some(inv => inv.inviteeId === user.id && (inv.status === 'PENDING' || inv.status === 'ACCEPTED'));
    if (isInvited) {
      return { allowed: true, code: 'ALLOWED' };
    }

    // Direct Link Access (Public, College Only, Private details viewing allowed per specification)
    return { allowed: true, code: 'ALLOWED' };
  }

  /**
   * 3. JOIN PERMISSION (canJoin):
   * Determines if a user is authorized to JOIN an activity.
   * Rules:
   * - Creator: Host (already member).
   * - Active Member: Already joined.
   * - Activity status not OPEN (e.g. ENDED, CANCELLED): DENIED ("NOT_OPEN").
   * - Activity full (maxMembers reached): DENIED ("FULL").
   * - INVITATION OVERRIDE: Explicitly invited user (status PENDING/ACCEPTED) can JOIN regardless of PUBLIC, COLLEGE_ONLY, or PRIVATE.
   * - PRIVATE ("No One"): CANNOT join unless explicitly invited or creator.
   * - COLLEGE_ONLY ("College"):
   *   - Same college: ALLOWED.
   *   - Different college: DENIED ("COLLEGE_RESTRICTED") unless invited.
   * - PUBLIC: ALLOWED.
   */
  canJoin(user: UserAuthContext, activity: ActivityAuthTarget): AuthDecision {
    if (!user) {
      return { allowed: false, reason: 'Authentication required', code: 'NOT_FOUND' };
    }

    if (activity.creatorId === user.id) {
      return { allowed: true, code: 'ALLOWED' };
    }

    const isMember = activity.members?.some(m => m.userId === user.id && m.status === 'MEMBER');
    if (isMember) {
      return { allowed: true, code: 'ALLOWED' };
    }

    // Status check
    if (activity.status !== CrewActivityStatus.OPEN) {
      return { allowed: false, reason: 'Activity is not open for joining', code: 'NOT_OPEN' };
    }

    // Max capacity check
    const currentMemberCount = activity._count?.members ?? activity.members?.filter(m => m.status === 'MEMBER').length ?? 0;
    if (activity.maxMembers && currentMemberCount >= activity.maxMembers) {
      return { allowed: false, reason: 'Activity is full', code: 'FULL' };
    }

    // INVITATION OVERRIDE: Check if user has an active invitation
    const isInvited = activity.invitations?.some(inv => inv.inviteeId === user.id && (inv.status === 'PENDING' || inv.status === 'ACCEPTED'));
    if (isInvited) {
      return { allowed: true, code: 'ALLOWED' };
    }

    // PRIVATE ("No One") visibility check
    if (activity.visibility === ActivityVisibility.PRIVATE) {
      return {
        allowed: false,
        reason: 'This activity is private and can only be joined via invitation.',
        code: 'PRIVATE'
      };
    }

    // COLLEGE_ONLY ("College") visibility check
    if (activity.visibility === ActivityVisibility.COLLEGE_ONLY || activity.shareToCampus) {
      if (!user.collegeId || !activity.collegeId || user.collegeId !== activity.collegeId) {
        return {
          allowed: false,
          reason: 'This activity is restricted to students from the host college.',
          code: 'COLLEGE_RESTRICTED'
        };
      }
    }

    return { allowed: true, code: 'ALLOWED' };
  }
}
