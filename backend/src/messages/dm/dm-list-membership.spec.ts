import { DmService } from './dm.service';
import { createVerificationAccessMock } from '../../common/verification/testing/verification-access.mock';
import { createStudentYearPolicyMock } from '../../common/student-year/testing/student-year-policy.mock';

/**
 * The DM list reports whether the viewer is still in each thread (A12).
 *
 * `isMember` was the literal `true`: the viewer's own `leftAt` was never
 * selected. A DM's `leftAt` could be set through the group leave and
 * remove-member routes, which accepted DM ids until they were made
 * group-only. Rows set that way still exist, and for them the history is
 * capped at `leftAt` and lookupExistingDM already treats the thread as gone,
 * so the list says the same thing.
 *
 * The fake returns only the participant columns the query selects, as the
 * database does, so a select that omits `leftAt` fails here.
 */
describe('DmService.getUserDMConversations — isMember', () => {
  const VIEWER = 'viewer';
  const conversationFor = (id: string) => ({
    id,
    publicId: id,
    name: null,
    avatarKey: null,
    description: null,
    type: 'DM',
    ownerId: VIEWER,
    status: 'ACTIVE',
    isInstantMatch: false,
    expiresAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    participants: [
      {
        userId: 'partner',
        role: 'MEMBER',
        joinedAt: new Date('2026-01-01'),
        user: {
          id: 'partner',
          username: 'partner',
          displayName: 'Partner',
          avatar: null,
          verificationStatus: 'VERIFIED',
          batchYear: null,
          accountStatus: 'ACTIVE',
          deletedAt: null,
          settings: null,
        },
      },
    ],
  });
  const rows = [
    { leftAt: null, conversation: conversationFor('dm-live') },
    {
      leftAt: new Date('2026-02-01'),
      conversation: conversationFor('dm-left'),
    },
  ].map((r) => ({
    ...r,
    isMuted: false,
    isPinned: false,
    pinnedAt: null,
    clearedAt: null,
    lastReadAt: null,
    unreadCount: 0,
    groupUpdatesActive: true,
  }));

  const build = () => {
    const service = Object.create(DmService.prototype) as DmService;
    Object.assign(service, {
      prisma: {
        conversationParticipant: {
          findMany: ({ select }: { select: Record<string, unknown> }) =>
            Promise.resolve(
              rows.map((r) =>
                Object.fromEntries(
                  Object.entries(r).filter(([k]) => k in select),
                ),
              ),
            ),
        },
        // A thread with no messages is not listed, so each has one.
        message: {
          findMany: () =>
            Promise.resolve(
              rows.map((r) => ({
                id: `m-${r.conversation.id}`,
                conversationId: r.conversation.id,
                createdAt: new Date('2026-01-03'),
                senderId: 'partner',
                type: 'CHAT',
                payload: { text: 'hi' },
                sender: {
                  id: 'partner',
                  displayName: 'Partner',
                  username: 'partner',
                  accountStatus: 'ACTIVE',
                  deletedAt: null,
                },
              })),
            ),
        },
        follow: { findMany: () => Promise.resolve([]) },
        userSettings: { findUnique: () => Promise.resolve(null) },
      },
      presenceService: { getPresenceMany: () => Promise.resolve(new Map()) },
      blocksService: {
        getExcludedUserIds: () => Promise.resolve([]),
        getBlockedByUserIds: () => Promise.resolve([]),
      },
      verificationAccess: createVerificationAccessMock(),
      studentYearPolicy: createStudentYearPolicyMock(),
    });
    return service;
  };

  it('is true for a thread the viewer is in, and false for one they left', async () => {
    const list = (await build().getUserDMConversations(VIEWER)) as {
      id: string;
      isMember: boolean;
    }[];
    const byId = Object.fromEntries(list.map((c) => [c.id, c.isMember]));
    expect(byId).toEqual({ 'dm-live': true, 'dm-left': false });
  });
});
