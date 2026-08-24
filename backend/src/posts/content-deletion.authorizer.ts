import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { roleCan } from '../communities/moderator-permissions';

/** How the actor is entitled to delete. Drives the notification wording. */
export type DeletionAuthority = 'author' | 'owner' | 'moderator';

export type { CommunityRoleName } from '../communities/moderator-permissions';
type CommunityRoleName = 'OWNER' | 'MODERATOR' | 'MEMBER';

export interface DeletionRequest {
  actorId: string;
  authorId: string;
  /** null for a personal post — no community, so no moderation. */
  communityId: string | null;
}

/**
 * Who may delete someone else's post or comment.
 *
 * One authorizer for both content types on purpose. Posts and comments have
 * separate delete paths, and the rule is identical for both — a second copy is
 * a second place for the two to drift, which is how "the UI hides the button"
 * quietly becomes the only thing enforcing a permission.
 *
 * The rules, in the order they are decided:
 *
 *   1. Authors delete their own content. Always, everywhere, whatever role
 *      anyone holds.
 *   2. Outside a community there is no moderation. A personal post has no
 *      owner or moderators, so only its author can remove it.
 *   3. The community owner deletes anything in their community.
 *   4. A moderator deletes MEMBER content only — never the owner's, never
 *      another moderator's, and never their own via this route (that is rule 1).
 *   5. Everyone else is refused.
 *
 * The two "never" cases in rule 4 are the point of the whole feature: a
 * moderator must not be able to remove a peer's or the owner's content, so
 * seniority is compared explicitly rather than collapsed into a single
 * "is staff" boolean.
 */
@Injectable()
export class ContentDeletionAuthorizer {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve a user's standing in a community.
   *
   * `ownerId` on the community row wins over the membership table. The two can
   * disagree — an owner may have no membership row at all (see the repair
   * routine in CommunitiesService) — and reading only the table would demote a
   * real owner to MEMBER, which under rule 4 would let a moderator delete the
   * owner's posts. A missing row otherwise means MEMBER: the least privilege,
   * which is also the right answer for someone who has since left.
   */
  async resolveRole(
    userId: string,
    communityId: string,
    ownerId: string | null,
  ): Promise<CommunityRoleName> {
    if (ownerId && ownerId === userId) return 'OWNER';

    const membership = await this.prisma.communityMember.findUnique({
      where: { userId_communityId: { userId, communityId } },
      select: { role: true },
    });

    return (membership?.role as CommunityRoleName) ?? 'MEMBER';
  }

  /**
   * Decide, without throwing. Returns the authority the actor is acting under,
   * or null if they may not delete this content.
   */
  async resolveAuthority({
    actorId,
    authorId,
    communityId,
  }: DeletionRequest): Promise<DeletionAuthority | null> {
    if (actorId === authorId) return 'author';
    if (!communityId) return null;

    const community = await this.prisma.community.findUnique({
      where: { id: communityId },
      select: { id: true, ownerId: true, deletedAt: true },
    });
    // A community that is gone moderates nothing; the author keeps rule 1.
    if (!community || community.deletedAt) return null;

    const actorRole = await this.resolveRole(actorId, communityId, community.ownerId);
    if (actorRole === 'OWNER') return 'owner';
    // The capability table decides, not the role name — so what a new
    // moderator is promised at promotion time is what they actually get.
    if (!roleCan(actorRole, 'DELETE_MEMBER_CONTENT')) return null;

    const authorRole = await this.resolveRole(authorId, communityId, community.ownerId);
    return authorRole === 'MEMBER' ? 'moderator' : null;
  }

  /**
   * The same rule, resolved for a whole page of content in a bounded number of
   * queries, so a client can be told what it may delete.
   *
   * The UI has to know whether to offer a delete control, and the only safe way
   * to tell it is to answer with the rule the server actually enforces.
   * Re-deriving it in the client would put a second copy of an authorization
   * rule in a place that cannot enforce it, and the two would drift.
   *
   * Cost is three queries at most, and only when the viewer moderates
   * something: the communities on this page, the viewer's role in each, and —
   * only for communities where the viewer is a moderator — the roles of the
   * authors whose content is on the page.
   */
  async canDeleteEach(
    actorId: string | undefined,
    items: Array<{ authorId: string; communityId: string | null }>,
  ): Promise<boolean[]> {
    if (!actorId) return items.map(() => false);

    // Rule 1 needs nothing from the database.
    const own = items.map((i) => i.authorId === actorId);

    const communityIds = [
      ...new Set(items.map((i) => i.communityId).filter((id): id is string => Boolean(id))),
    ];
    if (communityIds.length === 0) return own;

    const [communities, myMemberships] = await Promise.all([
      this.prisma.community.findMany({
        where: { id: { in: communityIds }, deletedAt: null },
        select: { id: true, ownerId: true },
      }),
      this.prisma.communityMember.findMany({
        where: { userId: actorId, communityId: { in: communityIds } },
        select: { communityId: true, role: true },
      }),
    ]);

    const ownerOf = new Map(communities.map((c) => [c.id, c.ownerId]));
    const myRole = new Map(myMemberships.map((m) => [m.communityId, m.role as CommunityRoleName]));

    const roleIn = (communityId: string): CommunityRoleName | null => {
      if (!ownerOf.has(communityId)) return null; // deleted or unknown community
      if (ownerOf.get(communityId) === actorId) return 'OWNER';
      return myRole.get(communityId) ?? 'MEMBER';
    };

    // Only communities where the viewer is a moderator need author roles —
    // an owner may delete regardless, and a member may not delete regardless.
    const moderatedIds = communityIds.filter((id) => roleIn(id) === 'MODERATOR');
    const authorRoles = new Map<string, CommunityRoleName>();
    if (moderatedIds.length > 0) {
      const authorIds = [
        ...new Set(
          items
            .filter((i) => i.communityId && moderatedIds.includes(i.communityId))
            .map((i) => i.authorId),
        ),
      ];
      const rows = await this.prisma.communityMember.findMany({
        where: { communityId: { in: moderatedIds }, userId: { in: authorIds } },
        select: { communityId: true, userId: true, role: true },
      });
      rows.forEach((r) => authorRoles.set(`${r.communityId}:${r.userId}`, r.role as CommunityRoleName));
    }

    return items.map((item, idx) => {
      if (own[idx]) return true;
      if (!item.communityId) return false;

      const actorRole = roleIn(item.communityId);
      if (actorRole === 'OWNER') return true;
      if (!roleCan(actorRole, 'DELETE_MEMBER_CONTENT')) return false;

      // Missing row means MEMBER (left the community); the community owner is
      // never a MEMBER however the table reads.
      if (ownerOf.get(item.communityId) === item.authorId) return false;
      const authorRole =
        authorRoles.get(`${item.communityId}:${item.authorId}`) ?? 'MEMBER';
      return authorRole === 'MEMBER';
    });
  }

  /**
   * Decide, throwing the same ForbiddenException the delete paths already use
   * for "not yours".
   *
   * Deliberately the same message and status whether the actor is an outranked
   * moderator or an unrelated member: the refusal should not report who
   * outranks whom in a community the caller may not even belong to.
   */
  async assertCanDelete(
    request: DeletionRequest,
    kind: 'post' | 'comment',
  ): Promise<DeletionAuthority> {
    const authority = await this.resolveAuthority(request);
    if (!authority) {
      throw new ForbiddenException(
        kind === 'post' ? 'Not your post' : 'Not your comment',
      );
    }
    return authority;
  }
}
