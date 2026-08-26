import { NotificationFactory } from '../notifications/notification.factory';

/**
 * The product rule this whole feature rests on: an Instant Match conversation
 * is never part of normal Messages.
 *
 * The real defence is structural — Instant Match chats carry their own
 * ConversationType, so the `type: 'DM'` and `type: { in: ['DM','GROUP'] }`
 * filters on the conversation-list queries exclude them without those queries
 * needing to know Instant Match exists. These tests pin the pieces of that
 * rule which are plain logic rather than SQL, plus the query shapes
 * themselves, so a future edit that re-admits one fails here.
 */
describe('Instant Match isolation from normal Messages', () => {
  describe('conversation-list queries', () => {
    // Read from the source rather than asserted by hand: the point is that
    // these filters exist at all, and that they name types rather than the
    // legacy isInstantMatch flag.
    const readSource = (path: string) =>
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('fs').readFileSync(
        require('path').join(__dirname, '..', path),
        'utf8',
      );

    it('excludes Instant Match from the main conversation list', () => {
      const src = readSource('messages/messages.service.ts');
      expect(src).toContain("type: { in: ['DM', 'GROUP'] }");
    });

    it('keeps the DM list scoped to DMs', () => {
      const src = readSource('messages/dm/dm.service.ts');
      expect(src).toContain("conversation: { type: 'DM' }");
    });

    it('no longer exempts Instant Match from the empty-conversation rule', () => {
      // The old `!lastMsgInfo && !conv.isInstantMatch` exemption existed to
      // keep a message-less instant chat visible in Messages. That is exactly
      // the leak this feature removes.
      const src = readSource('messages/dm/dm.service.ts');
      expect(src).not.toContain('!conv.isInstantMatch');
    });

    it('creates the chat under its own conversation type', () => {
      const src = readSource('messages/messages.service.ts');
      expect(src).toContain("type: 'INSTANT_MATCH'");
    });
  });

  describe('message notifications', () => {
    const factory = new NotificationFactory();
    const actor = { id: 'alice', displayName: 'Alice', avatar: null };

    it('marks one for an Instant Match conversation as instant, and gives it no conversationId', () => {
      // The notification exists — the user is told about the message — but it
      // must be routable ONLY to the Instant Match chat. A conversationId is
      // what deep-links into Messages, where this conversation does not
      // exist, so there deliberately isn't one to route on.
      const dto = factory.createMessage(
        actor,
        { id: 'c1', type: 'INSTANT_MATCH' },
        'bob',
        'hi',
      );
      expect(dto).not.toBeNull();
      expect(dto?.metadata).toMatchObject({
        chatType: 'instant',
        isInstantMatch: true,
      });
      expect(dto?.metadata).not.toHaveProperty('conversationId');
      expect(dto?.metadata).not.toHaveProperty('publicId');
      expect(dto?.metadata).not.toHaveProperty('internalId');
    });

    it('does the same for a legacy row carrying only the old flag', () => {
      const dto = factory.createMessage(
        actor,
        { id: 'c1', type: 'DM', isInstantMatch: true },
        'bob',
        'hi',
      );
      expect(dto?.metadata).toMatchObject({
        chatType: 'instant',
        isInstantMatch: true,
      });
      expect(dto?.metadata).not.toHaveProperty('conversationId');
    });

    it('still builds one for a normal DM, marked normal and routable by id', () => {
      const dto = factory.createMessage(
        actor,
        { id: 'c2', type: 'DM' },
        'bob',
        'hi',
      );
      expect(dto).not.toBeNull();
      expect(dto).toMatchObject({ recipientId: 'bob', type: 'MESSAGE' });
      expect(dto?.metadata).toMatchObject({
        chatType: 'normal',
        isInstantMatch: false,
        conversationId: 'c2',
      });
    });

    it('still builds one for a group', () => {
      const dto = factory.createMessage(
        actor,
        { id: 'c3', type: 'GROUP', name: 'Crew' },
        'bob',
        'hi',
      );
      expect(dto).not.toBeNull();
      expect(dto?.metadata).toMatchObject({ isGroup: true });
    });
  });
});
