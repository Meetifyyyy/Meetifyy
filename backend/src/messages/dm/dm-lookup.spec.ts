import { Test, TestingModule } from '@nestjs/testing';
import { DmService } from './dm.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PresenceService } from '../../presence/presence.service';
import { DomainEventService } from '../../events/domain-event.service';
import { MentionsService } from '../../mentions/mentions.service';
import { blocksServiceMockProvider } from '../../users/testing/blocks.service.mock';

/**
 * `lookupExistingDM` answers "is there a DM here I can open?" for every Send
 * Message button in the app. It has to mean *openable*, not merely *present in
 * the database*: deleting or leaving a conversation keeps the Conversation row
 * and both participant rows, and only marks the caller's own row.
 *
 * Returning an unopenable id sent the client to a conversation the sidebar did
 * not list and the history endpoint refused, which surfaced as "This
 * conversation doesn't exist or you no longer have access to it".
 */
describe('DmService — lookupExistingDM', () => {
  const ME = 'user-me';
  const THEM = 'user-them';

  let service: DmService;
  let prisma: any;

  const conversationWhereFor = () =>
    prisma.conversation.findFirst.mock.calls[0][0].where;
  /** The participant filter the query applies to a given user id. */
  const filterFor = (userId: string) =>
    conversationWhereFor()
      .AND.map((c: any) => c.participants.some)
      .find((s: any) => s.userId === userId);

  beforeEach(async () => {
    prisma = {
      conversation: {
        findFirst: jest.fn(async () => ({
          id: 'conv-internal',
          publicId: 'conv-public',
        })),
      },
      conversationParticipant: { findMany: jest.fn(async () => []) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        blocksServiceMockProvider(),
        DmService,
        { provide: PrismaService, useValue: prisma },
        { provide: PresenceService, useValue: { getPresence: jest.fn() } },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
        {
          provide: MentionsService,
          useValue: { sanitize: jest.fn(async () => []) },
        },
      ],
    }).compile();

    service = module.get(DmService);
  });

  it("requires the caller's own participant row to be live", async () => {
    await service.lookupExistingDM(ME, THEM);
    // Both columns matter: deleting sets deletedAt, leaving sets leftAt, and
    // neither leaves a conversation the caller can open.
    expect(filterFor(ME)).toEqual({
      userId: ME,
      deletedAt: null,
      leftAt: null,
    });
  });

  it('does not care whether the other person deleted their copy', async () => {
    // Deletion is per-participant. Theirs is none of our business.
    await service.lookupExistingDM(ME, THEM);
    expect(filterFor(THEM)).toEqual({ userId: THEM });
  });

  it('looks only at DMs', async () => {
    await service.lookupExistingDM(ME, THEM);
    expect(conversationWhereFor().type).toBe('DM');
  });

  it('returns the public id under both keys, so either read works', async () => {
    await expect(service.lookupExistingDM(ME, THEM)).resolves.toEqual({
      id: 'conv-public',
      publicId: 'conv-public',
    });
  });

  it('falls back to the internal id when there is no public one', async () => {
    prisma.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-internal',
      publicId: null,
    });
    await expect(service.lookupExistingDM(ME, THEM)).resolves.toEqual({
      id: 'conv-internal',
      publicId: 'conv-internal',
    });
  });

  it('returns null when nothing openable matches, so the caller drafts instead', async () => {
    prisma.conversation.findFirst.mockResolvedValueOnce(null);
    await expect(service.lookupExistingDM(ME, THEM)).resolves.toBeNull();
  });

  it('refuses to look up a DM with yourself, without querying', async () => {
    await expect(service.lookupExistingDM(ME, ME)).resolves.toBeNull();
    await expect(service.lookupExistingDM(ME, '')).resolves.toBeNull();
    expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
  });
});
