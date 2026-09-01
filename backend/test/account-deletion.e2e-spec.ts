import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

import { AccountDeletionService } from '../src/account-deletion/account-deletion.service';
import { UserOtpService } from '../src/otp/user-otp.service';
import { AccountDeletionPurgeService } from '../src/account-deletion/account-deletion.purge.service';
import { RECOVERY_WINDOW_MS } from '../src/account-deletion/account-deletion.constants';
import { JwtGuard } from '../src/common/guards/jwt.guard';
import { isUnavailableUser } from '../src/common/users/deleted-user';

/**
 * The whole lifecycle, against a real Postgres.
 *
 * The unit suites drive fakes, which is the right tool for the race conditions
 * (you cannot reliably interleave two real transactions from one test process)
 * but proves nothing about the parts that are really the database's job:
 * whether `deletedAt` actually hides a row from the queries the product uses,
 * whether hard-deleting a post really does cascade away another user's
 * bookmark, and whether the purge violates a foreign key that no fake models.
 * That is what this covers.
 *
 * OPT-IN. It writes to whatever `DATABASE_URL` points at, so it refuses to run
 * unless `E2E_ACCOUNT_DELETION=1` is set — a full unit run must never quietly
 * start mutating a developer's database.
 *
 * SAFETY. Every row it creates is tagged with a per-run marker in a column the
 * product never matches on, and teardown deletes strictly by the ids collected
 * during setup. It never deletes by predicate, so a bug in this file cannot
 * reach a row it did not create.
 */
const ENABLED = process.env.E2E_ACCOUNT_DELETION === '1';
const describeIfEnabled = ENABLED ? describe : describe.skip;

describeIfEnabled('Account deletion — full lifecycle against a real database', () => {
  const RUN = randomUUID().slice(0, 8);
  const tag = (name: string) => `e2e_del_${RUN}_${name}`;

  /**
   * `DATABASE_URL` points at Supabase's transaction pooler, which reuses server
   * connections across sessions and therefore collides on Prisma's named
   * prepared statements (`42P05: prepared statement "s0" already exists`).
   * Without this flag the suite fails intermittently and in different places
   * each run, which reads as a bug in the code under test rather than in the
   * connection. The app itself already sets this in its own datasource URL.
   */
  const poolerSafeUrl = (): string => {
    const url = process.env.DATABASE_URL ?? '';
    if (!url || url.includes('pgbouncer=')) return url;
    return url + (url.includes('?') ? '&' : '?') + 'pgbouncer=true';
  };

  const prisma = new PrismaClient({
    datasources: { db: { url: poolerSafeUrl() } },
  });

  /** Everything this run created, for teardown. Ids only — never predicates. */
  const created = {
    users: [] as string[],
    posts: [] as string[],
    activities: [] as string[],
    conversations: [] as string[],
    comments: [] as string[],
  };

  let deletion: AccountDeletionService;
  let otpService: UserOtpService;
  let purge: AccountDeletionPurgeService;

  /** The account under test, and a bystander who must be left untouched. */
  let subjectId: string;
  let observerId: string;
  let subjectPostId: string;
  let subjectActivityId: string;
  let conversationId: string;
  let observerPostId: string;
  let subjectCommentId: string;

  const stubs = {
    redis: { getClient: () => null } as any,
    presence: { removePresence: async () => undefined } as any,
    events: { emit: async () => undefined } as any,
    // No R2 in this test: storage is a separate system with its own suite, and
    // the point here is the database's behaviour. The keys it WOULD delete are
    // captured so the assertions can check the right ones were collected.
    mediaCleanup: {
      extractStorageKey: (v: string | null) => v ?? null,
      queueMediaDeletion: async (keys: string[]) => {
        queuedMediaKeys.push(...keys);
      },
    } as any,
  };
  let queuedMediaKeys: string[] = [];

  /**
   * Rewinds the stored code so the resend cooldown does not block the next
   * issuance. The cooldown is deliberately enforced from the row rather than
   * from Redis, so this is the only honest way to step past it.
   */
  const rewindOtp = async () => {
    await prisma.userOtp.updateMany({
      where: { userId: subjectId },
      data: { createdAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
  };

  const createUser = async (name: string) => {
    const user = await prisma.user.create({
      data: {
        username: tag(name),
        displayName: `E2E ${name}`,
        email: `${tag(name)}@e2e.invalid`,
        avatar: `avatars/${tag(name)}.jpg`,
        cover: `profile-covers/${tag(name)}.jpg`,
        bio: 'e2e fixture',
      },
      select: { id: true },
    });
    created.users.push(user.id);
    return user.id;
  };

  beforeAll(async () => {
    await prisma.$connect();

    otpService = new UserOtpService(prisma as any, stubs.redis);
    deletion = new AccountDeletionService(
      prisma as any,
      stubs.redis,
      stubs.presence,
      stubs.events,
      // The real OTP service, against the real table: the codes it mints are
      // read back here rather than from an inbox, which is the only part of
      // the flow a test can stand in for. Everything it enforces — hashing,
      // single use, attempt ceilings — is exercised for real.
      otpService,
      // The mailer is stubbed. Email delivery is a separate system with its own
      // suite, and the assertion that matters is that a code was minted and the
      // right template was asked for.
      { sendAccountDeletionOtpEmail: async () => undefined,
        sendAccountRecoveryOtpEmail: async () => undefined } as any,
    );
    purge = new AccountDeletionPurgeService(
      prisma as any,
      stubs.redis,
      stubs.presence,
      stubs.events,
      stubs.mediaCleanup,
    );

    subjectId = await createUser('subject');
    observerId = await createUser('observer');

    // Content owned by the subject.
    const post = await prisma.post.create({
      data: { authorId: subjectId, text: 'e2e subject post' },
      select: { id: true },
    });
    subjectPostId = post.id;
    created.posts.push(post.id);

    const activity = await prisma.crewActivity.create({
      data: { creatorId: subjectId, title: tag('activity') },
      select: { id: true },
    });
    subjectActivityId = activity.id;
    created.activities.push(activity.id);

    // Content owned by the observer, which the subject engaged with.
    const otherPost = await prisma.post.create({
      data: { authorId: observerId, text: 'e2e observer post' },
      select: { id: true },
    });
    observerPostId = otherPost.id;
    created.posts.push(otherPost.id);

    const comment = await prisma.comment.create({
      data: {
        postId: observerPostId,
        authorId: subjectId,
        text: 'a comment that must survive as a tombstone',
      },
      select: { id: true },
    });
    subjectCommentId = comment.id;
    created.comments.push(comment.id);

    // The observer saved the subject's post, and follows them.
    await prisma.postBookmark.create({
      data: { userId: observerId, postId: subjectPostId },
    });
    await prisma.follow.create({
      data: { followerId: observerId, followingId: subjectId },
    });

    // A conversation between them, with a message from each side.
    const conversation = await prisma.conversation.create({
      data: {
        type: 'DM',
        publicId: tag('conv'),
        participants: {
          create: [{ userId: subjectId }, { userId: observerId }],
        },
      },
      select: { id: true },
    });
    conversationId = conversation.id;
    created.conversations.push(conversation.id);

    await prisma.message.createMany({
      data: [
        {
          conversationId,
          senderId: subjectId,
          payload: { text: 'from the subject' },
        },
        {
          conversationId,
          senderId: observerId,
          payload: { text: 'from the observer' },
        },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    // Strictly by collected id, innermost first, and each step isolated.
    //
    // The isolation is the point: an earlier version ran these as one straight
    // sequence, so the first foreign-key complaint aborted the rest and left
    // orphaned users behind in a shared database. A cleanup routine that gives
    // up halfway is worse than no cleanup, because it looks like it worked.
    const users = { in: created.users };
    const convs = { in: created.conversations };

    const steps: [string, () => Promise<unknown>][] = [
      ['userOtp', () => prisma.userOtp.deleteMany({ where: { userId: users } })],
      ['message', () =>
        prisma.message.deleteMany({
          where: { OR: [{ conversationId: convs }, { senderId: users }] },
        })],
      ['conversationParticipant', () =>
        prisma.conversationParticipant.deleteMany({
          where: { OR: [{ conversationId: convs }, { userId: users }] },
        })],
      ['conversation', () =>
        prisma.conversation.deleteMany({ where: { id: convs } })],
      ['commentLike', () =>
        prisma.commentLike.deleteMany({ where: { userId: users } })],
      ['comment', () =>
        prisma.comment.deleteMany({
          where: { OR: [{ id: { in: created.comments } }, { authorId: users }] },
        })],
      ['postBookmark', () =>
        prisma.postBookmark.deleteMany({ where: { userId: users } })],
      ['postLike', () => prisma.postLike.deleteMany({ where: { userId: users } })],
      ['post', () =>
        prisma.post.deleteMany({
          where: { OR: [{ id: { in: created.posts } }, { authorId: users }] },
        })],
      ['crewActivityMember', () =>
        prisma.crewActivityMember.deleteMany({ where: { userId: users } })],
      ['crewActivity', () =>
        prisma.crewActivity.deleteMany({
          where: {
            OR: [{ id: { in: created.activities } }, { creatorId: users }],
          },
        })],
      ['follow', () =>
        prisma.follow.deleteMany({
          where: { OR: [{ followerId: users }, { followingId: users }] },
        })],
      ['media', () => prisma.media.deleteMany({ where: { ownerId: users } })],
      ['notification', () =>
        prisma.notification.deleteMany({
          where: { OR: [{ recipientId: users }, { actorId: users }] },
        })],
      ['userSettings', () =>
        prisma.userSettings.deleteMany({ where: { userId: users } })],
      ['notificationPreferences', () =>
        prisma.notificationPreferences.deleteMany({ where: { userId: users } })],
      ['user', () => prisma.user.deleteMany({ where: { id: users } })],
    ];

    const failures: string[] = [];
    for (const [name, run] of steps) {
      try {
        await run();
      } catch (err) {
        failures.push(`${name}: ${(err as Error).message.split('\n')[0]}`);
      }
    }

    // Say so loudly rather than leaving rows in a shared database silently.
    const remaining = await prisma.user
      .findMany({ where: { id: users }, select: { id: true, username: true } })
      .catch(() => []);
    if (remaining.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `E2E CLEANUP INCOMPLETE — ${remaining.length} user(s) left behind:`,
        remaining,
        failures,
      );
    }

    created.users.forEach((id) => JwtGuard.unrevokeUser(id));
    await prisma.$disconnect();
  }, 120_000);

  // ── The reversible half ──────────────────────────────────────────────────
  describe('requesting deletion', () => {
    it('schedules the purge exactly 30 days out, on the database clock', async () => {
      const status = await deletion.requestDeletion(subjectId);

      const row = await prisma.user.findUniqueOrThrow({
        where: { id: subjectId },
        select: {
          accountStatus: true,
          deletedAt: true,
          deletionRequestedAt: true,
          scheduledPurgeAt: true,
          username: true,
          displayName: true,
        },
      });

      expect(row.accountStatus).toBe('PENDING_DELETION');
      expect(row.deletedAt).not.toBeNull();
      expect(
        row.scheduledPurgeAt!.getTime() - row.deletionRequestedAt!.getTime(),
      ).toBe(RECOVERY_WINDOW_MS);
      expect(status.recoverable).toBe(true);

      // Nothing anonymized yet — this is what makes recovery a pure state
      // transition with no data to reconstruct.
      expect(row.username).toBe(tag('subject'));
      expect(row.displayName).toBe('E2E subject');
    });

    it('hides the account from the queries the product actually uses', async () => {
      // The whole design rests on this: `deletedAt` is the column ~137
      // user-facing queries already filter on, so stamping it hides the account
      // everywhere at once. If that were not true, the design would be wrong.
      const byUsername = await prisma.user.findFirst({
        where: { username: tag('subject'), deletedAt: null },
      });
      expect(byUsername).toBeNull();

      const inSearch = await prisma.user.findMany({
        where: {
          deletedAt: null,
          accountStatus: 'ACTIVE',
          username: { contains: RUN },
        },
        select: { id: true },
      });
      expect(inSearch.map((u) => u.id)).not.toContain(subjectId);
    });

    it('leaves the conversation and both sides’ messages completely intact', async () => {
      const messages = await prisma.message.findMany({
        where: { conversationId },
        select: { senderId: true },
      });
      expect(messages).toHaveLength(2);
      expect(messages.map((m) => m.senderId).sort()).toEqual(
        [subjectId, observerId].sort(),
      );
    });

    it('presents the subject as a tombstone to the other participant', async () => {
      const sender = await prisma.user.findUniqueOrThrow({
        where: { id: subjectId },
        select: { id: true, accountStatus: true, deletedAt: true },
      });
      expect(isUnavailableUser(sender)).toBe(true);
    });
  });

  describe('recovering', () => {
    it('restores the account exactly as it was', async () => {
      await deletion.recoverAccount(subjectId);

      const row = await prisma.user.findUniqueOrThrow({
        where: { id: subjectId },
        select: {
          accountStatus: true,
          deletedAt: true,
          scheduledPurgeAt: true,
          username: true,
          displayName: true,
          avatar: true,
        },
      });

      expect(row.accountStatus).toBe('ACTIVE');
      expect(row.deletedAt).toBeNull();
      expect(row.scheduledPurgeAt).toBeNull();
      expect(row.username).toBe(tag('subject'));
      expect(row.displayName).toBe('E2E subject');
      expect(row.avatar).toBe(`avatars/${tag('subject')}.jpg`);

      // Visible again to the same query that could not find it a moment ago.
      const found = await prisma.user.findFirst({
        where: { username: tag('subject'), deletedAt: null },
        select: { id: true },
      });
      expect(found?.id).toBe(subjectId);
    });

    it('leaves the subject’s own content untouched by the round trip', async () => {
      const [post, activity, comment] = await Promise.all([
        prisma.post.findUnique({ where: { id: subjectPostId } }),
        prisma.crewActivity.findUnique({ where: { id: subjectActivityId } }),
        prisma.comment.findUnique({ where: { id: subjectCommentId } }),
      ]);
      expect(post).not.toBeNull();
      expect(activity).not.toBeNull();
      expect(comment?.isDeleted).toBe(false);
    });
  });

  // ── The one-time-code gate, against the real table ───────────────────────
  describe('the OTP gate', () => {
    it('requesting a code schedules nothing and stores only a hash', async () => {
      const challenge = await deletion.requestDeletionOtp(subjectId);
      expect(challenge.otpRequired).toBe(true);

      const account = await prisma.user.findUniqueOrThrow({
        where: { id: subjectId },
        select: { accountStatus: true, deletedAt: true },
      });
      expect(account.accountStatus).toBe('ACTIVE');
      expect(account.deletedAt).toBeNull();

      const row = await prisma.userOtp.findUniqueOrThrow({
        where: {
          userId_purpose: { userId: subjectId, purpose: 'ACCOUNT_DELETION' },
        },
      });
      // Keyed HMAC, so the table alone does not yield the code.
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.consumedAt).toBeNull();
      expect(row.attempts).toBe(0);
    });

    it('rejects a wrong code and burns an attempt without touching the account', async () => {
      await expect(
        deletion.confirmDeletion(subjectId, '000000'),
      ).rejects.toThrow();

      const [account, row] = await Promise.all([
        prisma.user.findUniqueOrThrow({
          where: { id: subjectId },
          select: { accountStatus: true },
        }),
        prisma.userOtp.findUniqueOrThrow({
          where: {
            userId_purpose: { userId: subjectId, purpose: 'ACCOUNT_DELETION' },
          },
        }),
      ]);
      expect(account.accountStatus).toBe('ACTIVE');
      expect(row.attempts).toBeGreaterThan(0);
    });

    it('issuing a new code replaces the old row rather than adding one', async () => {
      // The (userId, purpose) unique constraint is what makes "a new code
      // invalidates the previous one" a property of the schema. Asserted here
      // because it is the database, not the service, that enforces it.
      await rewindOtp();
      await deletion.requestDeletionOtp(subjectId);

      const rows = await prisma.userOtp.findMany({
        where: { userId: subjectId, purpose: 'ACCOUNT_DELETION' },
      });
      expect(rows).toHaveLength(1);
    });

    it('accepts the real code, and only once', async () => {
      await rewindOtp();
      // Read back from the service rather than an inbox — the only part of the
      // flow a test can stand in for.
      const { code } = await otpService.issue(subjectId, 'ACCOUNT_DELETION');

      await expect(
        deletion.confirmDeletion(subjectId, code),
      ).resolves.toMatchObject({ pendingDeletion: true });

      // Replay: the same correct code must not work a second time.
      await expect(
        deletion.confirmDeletion(subjectId, code),
      ).rejects.toThrow();
    });

    it('recovers with a real recovery code, and clears every outstanding code', async () => {
      const { code } = await otpService.issue(subjectId, 'ACCOUNT_RECOVERY');
      await expect(
        deletion.confirmRecovery(subjectId, code),
      ).resolves.toMatchObject({ pendingDeletion: false });

      const account = await prisma.user.findUniqueOrThrow({
        where: { id: subjectId },
        select: { accountStatus: true, deletedAt: true, username: true },
      });
      expect(account.accountStatus).toBe('ACTIVE');
      expect(account.deletedAt).toBeNull();
      expect(account.username).toBe(tag('subject'));

      // A deletion code issued moments before recovery would otherwise stay
      // live for the rest of its ten minutes — and it schedules a deletion.
      const leftover = await prisma.userOtp.findMany({
        where: { userId: subjectId },
      });
      expect(leftover).toEqual([]);
    });
  });

  // ── The irreversible half ────────────────────────────────────────────────
  describe('permanent deletion once the window has expired', () => {
    beforeAll(async () => {
      await deletion.requestDeletion(subjectId);
      // Fast-forward by moving the deadline into the past, rather than by
      // mocking a clock: the worker's eligibility test is a SQL predicate, so
      // the only honest way to test it is to make the row genuinely due.
      await prisma.user.update({
        where: { id: subjectId },
        data: { scheduledPurgeAt: new Date(Date.now() - 60_000) },
      });
      queuedMediaKeys = [];
    }, 60_000);

    it('is selected by the worker’s eligibility predicate', async () => {
      // The exact SQL predicate `findEligible` uses, run here rather than
      // calling `runSweep()` for this assertion. `runSweep` is deliberately
      // global — it purges every due account, which is right in production and
      // wrong in a test sharing a database with real data. Asserting on the
      // predicate proves the row is due without giving the test the power to
      // delete an account it did not create.
      const due = await prisma.user.findMany({
        where: {
          accountStatus: 'PENDING_DELETION',
          scheduledPurgeAt: { lte: new Date() },
          purgeAttempts: { lt: 5 },
          OR: [{ purgeStartedAt: null }, { purgeStartedAt: { lt: new Date(0) } }],
        },
        select: { id: true },
      });
      expect(due.map((u) => u.id)).toContain(subjectId);
    });

    it('is purged, anonymizing the row in place', async () => {
      const result = await purge.purgeUser(subjectId);
      expect(result.purged).toBe(true);

      const row = await prisma.user.findUniqueOrThrow({
        where: { id: subjectId },
        select: {
          accountStatus: true,
          purgeCompletedAt: true,
          username: true,
          displayName: true,
          avatar: true,
          cover: true,
          bio: true,
        },
      });
      expect(row.accountStatus).toBe('DELETED');
      expect(row.purgeCompletedAt).not.toBeNull();
      expect(row.displayName).toBe('Deleted User');
      expect(row.username).not.toBe(tag('subject'));
      expect(row.avatar).toBeNull();
      expect(row.cover).toBeNull();
      expect(row.bio).toBeNull();
    }, 60_000);

    it('hard-deletes the posts and activities', async () => {
      expect(
        await prisma.post.findUnique({ where: { id: subjectPostId } }),
      ).toBeNull();
      expect(
        await prisma.crewActivity.findUnique({
          where: { id: subjectActivityId },
        }),
      ).toBeNull();
    });

    it('removes the observer’s saved reference through the real cascade', async () => {
      // Asserted against the database rather than a mock precisely because it
      // relies on `PostBookmark.postId onDelete: Cascade` actually being in the
      // deployed schema — the kind of thing a fake cannot tell you.
      const saved = await prisma.postBookmark.findFirst({
        where: { userId: observerId, postId: subjectPostId },
      });
      expect(saved).toBeNull();
    });

    it('keeps the comment as a tombstone so the thread stays intact', async () => {
      const comment = await prisma.comment.findUniqueOrThrow({
        where: { id: subjectCommentId },
      });
      expect(comment.isDeleted).toBe(true);
      expect(comment.text).toBe('');
      // The row survives because Comment.parent is a self-relation with no
      // cascade — deleting a commented-on node would strand its replies.
      expect(comment.postId).toBe(observerPostId);
    });

    it('KEEPS the conversation and both sides’ messages', async () => {
      // The single most important assertion in this file. Message.senderId is
      // `onDelete: Cascade`, so deleting the User row would erase this person's
      // messages out of the OTHER participant's inbox. That is why permanent
      // deletion is an anonymization in place.
      const messages = await prisma.message.findMany({
        where: { conversationId },
        select: { senderId: true },
      });
      expect(messages).toHaveLength(2);
      expect(messages.map((m) => m.senderId)).toContain(subjectId);

      expect(
        await prisma.conversation.findUnique({ where: { id: conversationId } }),
      ).not.toBeNull();
    });

    it('renders the purged sender as a tombstone, not as a real person', async () => {
      const sender = await prisma.user.findUniqueOrThrow({
        where: { id: subjectId },
        select: {
          id: true,
          accountStatus: true,
          deletedAt: true,
          displayName: true,
        },
      });
      expect(isUnavailableUser(sender)).toBe(true);
      expect(sender.displayName).toBe('Deleted User');
    });

    it('drops the follow relationship without harming the observer', async () => {
      expect(
        await prisma.follow.findFirst({
          where: { followerId: observerId, followingId: subjectId },
        }),
      ).toBeNull();
      // The bystander is untouched — a purge must never damage another account.
      const observer = await prisma.user.findUniqueOrThrow({
        where: { id: observerId },
        select: { accountStatus: true, deletedAt: true, username: true },
      });
      expect(observer.accountStatus).toBe('ACTIVE');
      expect(observer.deletedAt).toBeNull();
      expect(observer.username).toBe(tag('observer'));
      expect(
        await prisma.post.findUnique({ where: { id: observerPostId } }),
      ).not.toBeNull();
    });

    it('queued the subject’s own media, and nothing of the observer’s', async () => {
      expect(queuedMediaKeys).toEqual(
        expect.arrayContaining([
          `avatars/${tag('subject')}.jpg`,
          `profile-covers/${tag('subject')}.jpg`,
        ]),
      );
      expect(queuedMediaKeys.join(' ')).not.toContain(tag('observer'));
    });

    it('refuses recovery after the purge', async () => {
      await expect(deletion.recoverAccount(subjectId)).rejects.toThrow();
    });

    it('is idempotent — purging again changes nothing and does not throw', async () => {
      const before = await prisma.user.findUniqueOrThrow({
        where: { id: subjectId },
        select: { username: true, purgeCompletedAt: true },
      });
      await expect(purge.purgeUser(subjectId)).resolves.toEqual({
        purged: false,
      });
      const after = await prisma.user.findUniqueOrThrow({
        where: { id: subjectId },
        select: { username: true, purgeCompletedAt: true },
      });
      expect(after).toEqual(before);
    }, 60_000);

    it('no longer matches the eligibility predicate', async () => {
      const due = await prisma.user.findMany({
        where: {
          accountStatus: 'PENDING_DELETION',
          scheduledPurgeAt: { lte: new Date() },
        },
        select: { id: true },
      });
      expect(due.map((u) => u.id)).not.toContain(subjectId);
    });
  });
});
