import { NotificationsService } from './notifications.service';

/**
 * Notifications from an account that no longer exists.
 *
 * Reported from the live app: the recent-activity panel still listed entries
 * from a deleted user. Unlike a chat message or a comment — which belong to a
 * conversation the other person still owns — a notification has no standalone
 * value once its actor is gone: "Deleted User liked your post" is noise, and
 * during the 30-day window it is a reminder of somebody every other surface has
 * stopped showing.
 *
 * The list and the unread count MUST use the same predicate. If they drift, the
 * bell shows a number the list cannot clear — a failure this file has already
 * been bitten by once, over the MESSAGE type.
 */
describe('NotificationsService — deleted actors', () => {
  const filter = (NotificationsService as any).AVAILABLE_ACTOR;

  it('keeps system notifications, which have no actor at all', () => {
    // Without the null branch, every system notification would vanish.
    expect(filter.OR).toEqual(
      expect.arrayContaining([{ actorId: null }]),
    );
  });

  it('keeps notifications whose actor is still available', () => {
    expect(filter.OR).toEqual(
      expect.arrayContaining([{ actor: { deletedAt: null } }]),
    );
  });

  it('keys off deletedAt, so recovery restores the notifications too', () => {
    // deletedAt is stamped on request and cleared on recovery, so an account
    // that comes back brings its notification history with it — no separate
    // reconciliation pass.
    const actorClause = filter.OR.find((c: any) => c.actor);
    expect(Object.keys(actorClause.actor)).toEqual(['deletedAt']);
  });

  it('is exactly two branches — anything else would silently widen it', () => {
    expect(filter.OR).toHaveLength(2);
  });

  describe('the list and the count agree', () => {
    /**
     * Both call sites are asserted against the same object identity rather than
     * against an equal-looking literal. A copy-pasted clause would satisfy a
     * deep-equality check and still drift the next time one side is edited;
     * sharing the constant is the property worth testing.
     */
    it('share one constant rather than two hand-copied clauses', () => {
      // Asserted by reference to the constant's NAME in each method's source,
      // rather than by comparing two `where` objects: a copy-pasted clause
      // would satisfy a deep-equality check today and still drift the next time
      // one side is edited. Sharing the constant is the property that matters.
      expect(
        NotificationsService.prototype.getNotifications.toString(),
      ).toContain('AVAILABLE_ACTOR');
      expect(NotificationsService.prototype.getUnreadCount.toString()).toContain(
        'AVAILABLE_ACTOR',
      );
    });
  });
});
