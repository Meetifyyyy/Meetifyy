import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  ActivityAuthorizationService,
  ActivityAuthTarget,
  UserAuthContext,
} from './activity-authorization.service';

/**
 * The §15 access matrix, expressed as executable expectations. Every row is a
 * (visibility × viewer) pair and asserts view, discover and join together —
 * the three must never disagree in a way that lets a user be denied the page
 * but permitted the API.
 */
describe('ActivityAuthorizationService', () => {
  const policy = new ActivityAuthorizationService();

  const GLA = 'college-gla';
  const OTHER = 'college-other';

  const host: UserAuthContext = { id: 'host-1', collegeId: GLA };
  const sameCollege: UserAuthContext = { id: 'user-same', collegeId: GLA };
  const otherCollege: UserAuthContext = { id: 'user-other', collegeId: OTHER };
  const noCollege: UserAuthContext = { id: 'user-nocollege', collegeId: null };

  const activity = (
    visibility: any,
    overrides: Partial<ActivityAuthTarget> = {},
  ): ActivityAuthTarget => ({
    id: 'act-1',
    creatorId: host.id,
    collegeId: GLA,
    visibility,
    status: 'OPEN',
    maxMembers: null,
    members: [],
    invitations: [],
    _count: { members: 1 },
    ...overrides,
  });

  const liveInvite = (inviteeId: string, extra: any = {}) => ({
    inviteeId,
    status: 'PENDING',
    revokedAt: null,
    expiresAt: null,
    ...extra,
  });

  // ── Anyone (PUBLIC) ────────────────────────────────────────────────────────
  describe('PUBLIC ("Anyone")', () => {
    const act = activity('PUBLIC');

    it('allows a same-college viewer to view, discover and join', () => {
      expect(policy.canView(sameCollege, act).allowed).toBe(true);
      expect(policy.canDiscover(sameCollege, act)).toBe(true);
      expect(policy.canJoin(sameCollege, act).allowed).toBe(true);
    });

    it('allows an other-college viewer to view, discover and join', () => {
      expect(policy.canView(otherCollege, act).allowed).toBe(true);
      expect(policy.canDiscover(otherCollege, act)).toBe(true);
      expect(policy.canJoin(otherCollege, act).allowed).toBe(true);
    });

    it('allows a viewer with no college at all', () => {
      expect(policy.canView(noCollege, act).allowed).toBe(true);
      expect(policy.canDiscover(noCollege, act)).toBe(true);
      expect(policy.canJoin(noCollege, act).allowed).toBe(true);
    });

    it('is viewable/discoverable with no authenticated user, but not joinable', () => {
      expect(policy.canView(null, act).allowed).toBe(true);
      expect(policy.canDiscover(null, act)).toBe(true);
      expect(policy.canJoin(null, act)).toMatchObject({
        allowed: false,
        code: 'AUTH_REQUIRED',
      });
    });

    it('ignores a stray shareToCampus flag — visibility is the only authority', () => {
      const flagged = activity('PUBLIC', { shareToCampus: true });
      expect(policy.canView(otherCollege, flagged).allowed).toBe(true);
      expect(policy.canDiscover(otherCollege, flagged)).toBe(true);
      expect(policy.canJoin(otherCollege, flagged).allowed).toBe(true);
    });
  });

  // ── College (COLLEGE_ONLY) ─────────────────────────────────────────────────
  describe('COLLEGE_ONLY ("College")', () => {
    const act = activity('COLLEGE_ONLY');

    it('allows the host', () => {
      expect(policy.canView(host, act).allowed).toBe(true);
      expect(policy.canJoin(host, act).allowed).toBe(true);
    });

    it('allows a same-college viewer', () => {
      expect(policy.canView(sameCollege, act).allowed).toBe(true);
      expect(policy.canDiscover(sameCollege, act)).toBe(true);
      expect(policy.canJoin(sameCollege, act).allowed).toBe(true);
    });

    it('denies an other-college viewer on every surface', () => {
      expect(policy.canView(otherCollege, act)).toMatchObject({
        allowed: false,
        code: 'COLLEGE_RESTRICTED',
      });
      expect(policy.canDiscover(otherCollege, act)).toBe(false);
      expect(policy.canJoin(otherCollege, act)).toMatchObject({
        allowed: false,
        code: 'COLLEGE_RESTRICTED',
      });
    });

    it('denies a viewer with no college', () => {
      expect(policy.canView(noCollege, act).allowed).toBe(false);
      expect(policy.canJoin(noCollege, act).allowed).toBe(false);
    });

    it('denies an anonymous viewer', () => {
      expect(policy.canView(null, act)).toMatchObject({
        allowed: false,
        code: 'COLLEGE_RESTRICTED',
      });
      expect(policy.canDiscover(null, act)).toBe(false);
    });

    it('allows an other-college viewer holding a live invitation', () => {
      const invited = activity('COLLEGE_ONLY', {
        invitations: [liveInvite(otherCollege.id)],
      });
      expect(policy.canView(otherCollege, invited).allowed).toBe(true);
      expect(policy.canDiscover(otherCollege, invited)).toBe(true);
      expect(policy.canJoin(otherCollege, invited).allowed).toBe(true);
    });

    it('does not let one activity’s invitation unlock another', () => {
      const other = activity('COLLEGE_ONLY', { id: 'act-2', invitations: [] });
      expect(policy.canView(otherCollege, other).allowed).toBe(false);
    });

    it('rejects an invitation issued to a different user', () => {
      const invited = activity('COLLEGE_ONLY', {
        invitations: [liveInvite('someone-else')],
      });
      expect(policy.canView(otherCollege, invited).allowed).toBe(false);
    });

    it('rejects a revoked invitation', () => {
      const invited = activity('COLLEGE_ONLY', {
        invitations: [liveInvite(otherCollege.id, { revokedAt: new Date() })],
      });
      expect(policy.canView(otherCollege, invited).allowed).toBe(false);
      expect(policy.canJoin(otherCollege, invited).allowed).toBe(false);
    });

    it('rejects an expired invitation', () => {
      const invited = activity('COLLEGE_ONLY', {
        invitations: [
          liveInvite(otherCollege.id, {
            expiresAt: new Date(Date.now() - 1000),
          }),
        ],
      });
      expect(policy.canView(otherCollege, invited).allowed).toBe(false);
    });

    it('rejects a declined / cancelled / expired-status invitation', () => {
      for (const status of ['DECLINED', 'CANCELLED', 'EXPIRED']) {
        const invited = activity('COLLEGE_ONLY', {
          invitations: [liveInvite(otherCollege.id, { status })],
        });
        expect(policy.canView(otherCollege, invited).allowed).toBe(false);
      }
    });

    it('accepts an ACCEPTED invitation', () => {
      const invited = activity('COLLEGE_ONLY', {
        invitations: [liveInvite(otherCollege.id, { status: 'ACCEPTED' })],
      });
      expect(policy.canView(otherCollege, invited).allowed).toBe(true);
    });

    it('denies when the activity carries no college at all', () => {
      const orphan = activity('COLLEGE_ONLY', { collegeId: null });
      expect(policy.canView(sameCollege, orphan).allowed).toBe(false);
    });

    it('keeps access for an existing member from another college', () => {
      const joined = activity('COLLEGE_ONLY', {
        members: [{ userId: otherCollege.id, status: 'MEMBER' }],
      });
      expect(policy.canView(otherCollege, joined).allowed).toBe(true);
    });
  });

  // ── Private (PRIVATE) ──────────────────────────────────────────────────────
  describe('PRIVATE ("Private")', () => {
    const act = activity('PRIVATE');

    it('gives the host full access', () => {
      expect(policy.canView(host, act).allowed).toBe(true);
      expect(policy.canJoin(host, act).allowed).toBe(true);
      expect(policy.canManage(host, act)).toBe(true);
    });

    it('denies a same-college viewer who was not invited', () => {
      expect(policy.canView(sameCollege, act)).toMatchObject({
        allowed: false,
        code: 'PRIVATE',
      });
      expect(policy.canJoin(sameCollege, act)).toMatchObject({
        allowed: false,
        code: 'PRIVATE',
      });
    });

    it('denies an other-college viewer who was not invited', () => {
      expect(policy.canView(otherCollege, act)).toMatchObject({
        allowed: false,
        code: 'PRIVATE',
      });
      expect(policy.canJoin(otherCollege, act).allowed).toBe(false);
    });

    it('allows an explicitly invited viewer to view and join', () => {
      const invited = activity('PRIVATE', {
        invitations: [liveInvite(otherCollege.id)],
      });
      expect(policy.canView(otherCollege, invited).allowed).toBe(true);
      expect(policy.canJoin(otherCollege, invited).allowed).toBe(true);
    });

    it('is never organically discoverable — not even by the host or an invitee', () => {
      const invited = activity('PRIVATE', {
        invitations: [liveInvite(otherCollege.id)],
      });
      expect(policy.canDiscover(host, act)).toBe(false);
      expect(policy.canDiscover(sameCollege, act)).toBe(false);
      expect(policy.canDiscover(otherCollege, invited)).toBe(false);
      expect(policy.canDiscover(null, act)).toBe(false);
    });
  });

  // ── Join-specific rules ────────────────────────────────────────────────────
  describe('canJoin — activity rules', () => {
    it('rejects a cancelled activity', () => {
      const act = activity('PUBLIC', { status: 'CANCELLED' });
      expect(policy.canJoin(sameCollege, act)).toMatchObject({
        allowed: false,
        code: 'CANCELLED',
      });
    });

    it('rejects an ended activity', () => {
      const act = activity('PUBLIC', { status: 'ENDED' });
      expect(policy.canJoin(sameCollege, act)).toMatchObject({
        allowed: false,
        code: 'NOT_OPEN',
      });
    });

    it('rejects a full activity', () => {
      const act = activity('PUBLIC', { maxMembers: 2, _count: { members: 2 } });
      expect(policy.canJoin(sameCollege, act)).toMatchObject({
        allowed: false,
        code: 'FULL',
      });
    });

    it('does not let an invitation override capacity or status', () => {
      const full = activity('PRIVATE', {
        maxMembers: 2,
        _count: { members: 2 },
        invitations: [liveInvite(otherCollege.id)],
      });
      expect(policy.canJoin(otherCollege, full)).toMatchObject({
        allowed: false,
        code: 'FULL',
      });

      const cancelled = activity('PRIVATE', {
        status: 'CANCELLED',
        invitations: [liveInvite(otherCollege.id)],
      });
      expect(policy.canJoin(otherCollege, cancelled)).toMatchObject({
        allowed: false,
        code: 'CANCELLED',
      });
    });

    it('lets an existing member through even when the activity is full', () => {
      const act = activity('PUBLIC', {
        maxMembers: 2,
        _count: { members: 2 },
        members: [{ userId: sameCollege.id, status: 'MEMBER' }],
      });
      expect(policy.canJoin(sameCollege, act).allowed).toBe(true);
    });

    it('never permits joining something the viewer may not view', () => {
      for (const visibility of ['COLLEGE_ONLY', 'PRIVATE']) {
        const act = activity(visibility);
        expect(policy.canView(otherCollege, act).allowed).toBe(false);
        expect(policy.canJoin(otherCollege, act).allowed).toBe(false);
      }
    });
  });

  // ── Denial responses ───────────────────────────────────────────────────────
  describe('assertCanView', () => {
    it('throws a detail-free 403 for another college', () => {
      try {
        policy.assertCanView(otherCollege, activity('COLLEGE_ONLY'));
        fail('expected a ForbiddenException');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const body = err.getResponse();
        expect(body.code).toBe('COLLEGE_RESTRICTED');
        expect(body.message).toMatch(/another college/i);
        expect(JSON.stringify(body)).not.toMatch(/act-1|host-1/);
      }
    });

    it('throws a bare 404 for a private activity, disclosing nothing', () => {
      try {
        policy.assertCanView(sameCollege, activity('PRIVATE'));
        fail('expected a NotFoundException');
      } catch (err: any) {
        // 404, not 403: a "forbidden" would confirm to a stranger holding a
        // copied link that the activity exists at all.
        expect(err.getStatus()).toBe(404);
        const serialized = JSON.stringify(err.getResponse());
        expect(serialized).not.toContain('PRIVATE');
        expect(serialized).not.toContain('act-1');
      }
    });

    it('does not throw for an authorized viewer', () => {
      expect(() =>
        policy.assertCanView(sameCollege, activity('PUBLIC')),
      ).not.toThrow();
    });
  });

  describe('assertCanManage', () => {
    it('answers 404 (not 403) to a non-host so the id is not confirmed', () => {
      expect(() =>
        policy.assertCanManage(sameCollege, activity('PUBLIC')),
      ).toThrow(NotFoundException);
    });

    it('allows the host', () => {
      expect(() =>
        policy.assertCanManage(host, activity('PRIVATE')),
      ).not.toThrow();
    });
  });

  // ── Query-layer filters ────────────────────────────────────────────────────

  /**
   * Every builder now returns `{ AND: [ <visibility>, <available host> ] }`.
   * These helpers read the two halves so the assertions below stay about the
   * rule being tested rather than about the wrapper's shape.
   */
  const visibilityOf = (where: any): any => {
    const and = where.AND as any[] | undefined;
    if (!Array.isArray(and)) return where;
    const inner = and.find((c) => !('creator' in c));
    return inner ?? where;
  };
  const clausesOf = (where: any): any[] => {
    const v = visibilityOf(where);
    return (v.OR as any[]) ?? [v];
  };
  /** The host-availability half, which every builder must carry. */
  const hostFilterOf = (where: any): any =>
    (where.AND as any[] | undefined)?.find((c) => 'creator' in c);

  // A host inside their 30-day deletion window is hidden from everyone, so
  // their activities have to be too — enforced in the policy rather than at a
  // dozen call sites, one of which would eventually be missed.
  describe.each([
    ['discoveryWhere', (u: any) => policy.discoveryWhere(u)],
    ['sharedAudienceWhere', (u: any) => policy.sharedAudienceWhere(u)],
    ['accessWhere', (u: any) => policy.accessWhere(u)],
  ])('%s — host availability', (_name, build) => {
    it.each([
      ['a signed-in viewer', () => sameCollege],
      ['a viewer with no college', () => noCollege],
      ['an anonymous viewer', () => null],
    ])('excludes activities hosted by a deleted account for %s', (_who, who) => {
      expect(hostFilterOf(build(who()))).toEqual({
        creator: { deletedAt: null },
      });
    });
  });

  describe('discoveryWhere', () => {
    it('restricts an anonymous viewer to PUBLIC only', () => {
      expect(visibilityOf(policy.discoveryWhere(null))).toEqual({
        visibility: 'PUBLIC',
      });
    });

    it('never admits PRIVATE for any viewer', () => {
      const serialized = JSON.stringify(policy.discoveryWhere(sameCollege));
      expect(serialized).not.toContain('PRIVATE');
    });

    it('admits the viewer’s own college, invitations and memberships', () => {
      const clauses = clausesOf(policy.discoveryWhere(sameCollege));
      expect(clauses).toEqual(
        expect.arrayContaining([
          { visibility: 'PUBLIC' },
          expect.objectContaining({
            visibility: 'COLLEGE_ONLY',
            collegeId: GLA,
          }),
        ]),
      );
      expect(JSON.stringify(clauses)).toContain('invitations');
      expect(JSON.stringify(clauses)).toContain('members');
    });

    it('omits the college clause for a viewer with no college', () => {
      const clauses = clausesOf(policy.discoveryWhere(noCollege));
      expect(clauses.some((c) => 'collegeId' in c)).toBe(false);
    });
  });

  describe('sharedAudienceWhere', () => {
    it('depends only on the viewer’s college, never on their identity', () => {
      const serialized = JSON.stringify(
        policy.sharedAudienceWhere(sameCollege),
      );
      expect(serialized).not.toContain(sameCollege.id);
      expect(serialized).not.toContain('invitations');
      expect(serialized).not.toContain('members');
      expect(serialized).not.toContain('creatorId');
    });

    it('admits PUBLIC plus the viewer’s own college', () => {
      expect(visibilityOf(policy.sharedAudienceWhere(sameCollege))).toEqual({
        OR: [
          { visibility: 'PUBLIC' },
          { visibility: 'COLLEGE_ONLY', collegeId: GLA },
        ],
      });
    });

    it('never admits PRIVATE', () => {
      expect(
        JSON.stringify(policy.sharedAudienceWhere(sameCollege)),
      ).not.toContain('PRIVATE');
    });

    it('falls back to PUBLIC-only without a college or a viewer', () => {
      expect(visibilityOf(policy.sharedAudienceWhere(noCollege))).toEqual({
        visibility: 'PUBLIC',
      });
      expect(visibilityOf(policy.sharedAudienceWhere(null))).toEqual({
        visibility: 'PUBLIC',
      });
    });
  });

  describe('accessWhere', () => {
    it('additionally admits hosted, joined and invited PRIVATE activities', () => {
      const clauses = clausesOf(policy.accessWhere(sameCollege));
      expect(clauses).toEqual(
        expect.arrayContaining([{ creatorId: sameCollege.id }]),
      );
      expect(JSON.stringify(clauses)).toContain('invitations');
    });

    it('still carries the discovery visibility clauses', () => {
      // `discoveryWhere` returns an AND wrapper now, so a naive `.OR` read in
      // accessWhere would find nothing and silently collapse this to the
      // personal clauses alone — dropping every public activity from bookmarks.
      const clauses = clausesOf(policy.accessWhere(sameCollege));
      expect(clauses).toEqual(
        expect.arrayContaining([{ visibility: 'PUBLIC' }]),
      );
    });

    it('restricts an anonymous viewer to PUBLIC only', () => {
      expect(visibilityOf(policy.accessWhere(null))).toEqual({
        visibility: 'PUBLIC',
      });
    });
  });

  describe('validInvitationWhere', () => {
    it('excludes revoked rows and non-live statuses at the query layer', () => {
      const where: any = policy.validInvitationWhere('u1');
      expect(where.inviteeId).toBe('u1');
      expect(where.revokedAt).toBeNull();
      expect(where.status).toEqual({ in: ['PENDING', 'ACCEPTED'] });
      expect(where.OR).toEqual([
        { expiresAt: null },
        { expiresAt: { gt: expect.any(Date) } },
      ]);
    });
  });
});
