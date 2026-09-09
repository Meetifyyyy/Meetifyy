import { StorageService } from './uploads.service';

/**
 * Chat attachments belong to the conversation, not to whoever holds the URL.
 *
 * They were public. The key is 32 random hex characters, so guessing one was
 * never the risk — the risk is that the URL was itself the credential. Anyone
 * who came by one, however innocently (a forwarded link, a referrer header, a
 * proxy log), had that image permanently, with no way to revoke it, and it kept
 * working after the message was deleted.
 *
 * These pin the authorization decision itself. Enforcing it at all is only
 * possible because the session is a cookie now: an `<img>` tag cannot send an
 * Authorization header, so while the token lived in JavaScript a plain image
 * request could not be authorized at any price.
 */
describe('conversation media privacy', () => {
  let prisma: any;
  let service: StorageService;

  const KEY = 'chat/deadbeefdeadbeefdeadbeefdeadbeef.webp';

  beforeEach(() => {
    prisma = {
      media: { findUnique: jest.fn() },
      message: { findFirst: jest.fn() },
    };
    // (provider, prisma, config) — only prisma is exercised here.
    service = new StorageService({} as any, prisma, {} as any);
  });

  describe('which folders are conversation-scoped', () => {
    it.each(['chat', 'messages', 'voice'])('treats %s as scoped', (folder) => {
      expect(service.isConversationScopedKey(`${folder}/x.webp`)).toBe(true);
    });

    it.each(['posts', 'avatars', 'community', 'defaults'])(
      'leaves %s public',
      (folder) => {
        expect(service.isConversationScopedKey(`${folder}/x.webp`)).toBe(false);
      },
    );
  });

  it('lets the uploader see their own attachment', async () => {
    prisma.media.findUnique.mockResolvedValue({ id: 'm1', ownerId: 'sender' });
    expect(await service.canViewConversationMedia(KEY, 'sender')).toBe(true);
    // Ownership answered it; no message lookup was needed.
    expect(prisma.message.findFirst).not.toHaveBeenCalled();
  });

  it('lets a participant in the conversation see it', async () => {
    prisma.media.findUnique.mockResolvedValue({ id: 'm1', ownerId: 'sender' });
    prisma.message.findFirst.mockResolvedValue({ id: 'msg1' });
    expect(await service.canViewConversationMedia(KEY, 'recipient')).toBe(true);
  });

  /** The actual vulnerability: a stranger holding the URL. */
  it('refuses someone who is in no conversation it was sent to', async () => {
    prisma.media.findUnique.mockResolvedValue({ id: 'm1', ownerId: 'sender' });
    prisma.message.findFirst.mockResolvedValue(null);
    expect(await service.canViewConversationMedia(KEY, 'stranger')).toBe(false);
  });

  it('refuses an anonymous caller outright', async () => {
    expect(await service.canViewConversationMedia(KEY, null)).toBe(false);
    expect(await service.canViewConversationMedia(KEY, undefined)).toBe(false);
    expect(prisma.media.findUnique).not.toHaveBeenCalled();
  });

  it('refuses a key with no media row', async () => {
    prisma.media.findUnique.mockResolvedValue(null);
    expect(await service.canViewConversationMedia(KEY, 'anyone')).toBe(false);
  });

  it('refuses a malformed key without touching the database', async () => {
    expect(await service.canViewConversationMedia('../../etc/passwd', 'u1')).toBe(false);
    expect(prisma.media.findUnique).not.toHaveBeenCalled();
  });

  /**
   * The participation query must exclude people who left or were removed —
   * otherwise leaving a group would keep its attachments readable forever.
   */
  it('scopes participation to live membership', async () => {
    prisma.media.findUnique.mockResolvedValue({ id: 'm1', ownerId: 'sender' });
    prisma.message.findFirst.mockResolvedValue(null);
    await service.canViewConversationMedia(KEY, 'ex-member');

    const where = prisma.message.findFirst.mock.calls[0][0].where;
    const participant = where.conversation.participants.some;
    expect(participant.deletedAt).toBeNull();
    expect(participant.leftAt).toBeNull();
  });
});
