import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

/**
 * Migration 47: Message and Notification keep only indexes their reads use,
 * and the list reads are served in the order they are shown.
 *
 * The plan checks run the SQL Prisma itself generates for each screen, with
 * sorting and sequential scans disabled, so an index that cannot deliver the
 * query's order shows up as a Sort in the plan whatever the table size. That
 * is exactly what (recipientId, deletedAt, createdAt) could not do: with an
 * IS NULL test on deletedAt, the createdAt order is lost.
 *
 * Needs a disposable database with every migration applied, named in BOTH
 * `DATABASE_URL` and `SCHEMA_TEST_DATABASE_URL`, on localhost. Skipped
 * otherwise, so it can never run against a shared database.
 */
const TEST_URL = process.env.SCHEMA_TEST_DATABASE_URL ?? '';
const runnable =
  TEST_URL !== '' &&
  process.env.DATABASE_URL === TEST_URL &&
  /@(127\.0\.0\.1|localhost):\d+\//.test(TEST_URL);
const describeDb = runnable ? describe : describe.skip;

const DROPPED = [
  'Message_conversationId_createdAt_senderId_idx',
  'Message_conversationId_deletedAt_createdAt_id_idx',
  'idx_message_conv_sort',
  'Notification_recipientId_readAt_idx',
  'Notification_recipientId_deletedAt_readAt_idx',
  'Notification_recipientId_deletedAt_createdAt_idx',
  'Notification_recipientId_deletedAt_type_createdAt_idx',
  'Notification_createdAt_idx',
  'Notification_type_idx',
];

const KEPT = [
  'Message_pkey',
  'Message_conversationId_createdAt_id_idx',
  'Message_senderId_clientMessageId_key',
  'idx_message_reply_to_id',
  'idx_message_attachment_media_id',
  'Notification_pkey',
  'Notification_recipientId_actorId_entityId_type_key',
  'Notification_recipientId_createdAt_id_idx',
  'Notification_recipientId_type_createdAt_id_idx',
  'idx_notif_recipient_unread',
  'idx_notification_actor_id',
  'idx_notification_entity_id',
];

const RECIPIENT = 'idx-spec-recipient';
const CONVERSATION = 'idx-spec-conversation';

describeDb('Message and Notification indexes (database)', () => {
  let prisma: PrismaService;
  let statements: Array<{ query: string; params: string }> = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    prisma.$on('query', (e: Prisma.QueryEvent) => {
      statements.push({ query: e.query, params: e.params });
    });
    await prisma.$connect();
    // One person with 290 likes and 10 invitations, analysed, so the planner
    // has the statistics that make the Invitations index the cheaper one.
    await prisma.$executeRaw`
      INSERT INTO "User" (id, username, "displayName", email, "updatedAt")
      VALUES (${RECIPIENT}, 'idx_spec_recipient', 'Index Spec', 'idx-spec@example.test', now())`;
    await prisma.$executeRaw`
      INSERT INTO "Notification" (id, "recipientId", "entityId", type, "createdAt", "updatedAt")
      SELECT 'idx-spec-n' || g, ${RECIPIENT}, 'idx-spec-e' || g,
             (CASE WHEN g % 30 = 0 THEN 'ACTIVITY_INVITE' ELSE 'LIKE' END)::"NotificationType",
             now() - (g || ' minutes')::interval, now()
      FROM generate_series(1, 300) g`;
    await prisma.$executeRawUnsafe('ANALYZE "Notification"');
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM "Notification" WHERE "recipientId" = ${RECIPIENT}`;
    await prisma.$executeRaw`DELETE FROM "User" WHERE id = ${RECIPIENT}`;
    await prisma.$disconnect();
  });

  /**
   * Runs `read` through Prisma, then EXPLAINs the one statement it sent on
   * the table, with sorts and sequential scans priced out of the plan.
   */
  async function planOf(
    table: 'Message' | 'Notification',
    read: () => Promise<unknown>,
  ): Promise<string> {
    statements = [];
    await read();
    const sent = statements.filter((s) =>
      new RegExp(`^SELECT .* FROM "public"\\."${table}" AS "t0"`).test(s.query),
    );
    expect(sent).toHaveLength(1);
    const params = JSON.parse(sent[0].params) as unknown[];
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      await tx.$executeRawUnsafe('SET LOCAL enable_sort = off');
      const rows = await tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
        `EXPLAIN ${sent[0].query}`,
        ...params,
      );
      return rows.map((r) => r['QUERY PLAN']).join('\n');
    });
  }

  it('drops the nine indexes nothing needs and keeps the rest', async () => {
    const rows = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT indexname::text AS name FROM pg_indexes
      WHERE schemaname = 'public' AND tablename IN ('Message', 'Notification')`;
    const names = new Set(rows.map((r) => r.name));
    expect(DROPPED.filter((n) => names.has(n))).toEqual([]);
    expect(KEPT.filter((n) => !names.has(n))).toEqual([]);
    expect(names.size).toBe(KEPT.length);
  });

  it('reads the notification list in order, without sorting', async () => {
    const plan = await planOf('Notification', () =>
      prisma.notification.findMany({
        where: {
          recipientId: RECIPIENT,
          deletedAt: null,
          AND: [{ OR: [{ actorId: null }, { actor: { deletedAt: null } }] }],
          type: { notIn: ['MESSAGE'] },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 21,
      }),
    );
    expect(plan).toContain('Notification_recipientId_createdAt_id_idx');
    expect(plan).not.toMatch(/\bSort\b/);
  });

  it('reads the Invitations tab in order, without sorting', async () => {
    const plan = await planOf('Notification', () =>
      prisma.notification.findMany({
        where: {
          recipientId: RECIPIENT,
          deletedAt: null,
          type: 'ACTIVITY_INVITE',
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 21,
      }),
    );
    expect(plan).toContain('Notification_recipientId_type_createdAt_id_idx');
    expect(plan).not.toMatch(/\bSort\b/);
  });

  it('reads a chat page in order, without sorting', async () => {
    const plan = await planOf('Message', () =>
      prisma.message.findMany({
        where: {
          conversationId: CONVERSATION,
          deletedAt: null,
          id: { notIn: ['deleted-for-me'] },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 51,
      }),
    );
    expect(plan).toContain('Message_conversationId_createdAt_id_idx');
    expect(plan).not.toMatch(/\bSort\b/);
  });

  it('reads the catch-up sync forwards through the same index', async () => {
    const plan = await planOf('Message', () =>
      prisma.message.findMany({
        where: {
          conversationId: CONVERSATION,
          createdAt: { gt: new Date(0) },
          deletedAt: null,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 201,
      }),
    );
    expect(plan).toContain('Message_conversationId_createdAt_id_idx');
    expect(plan).not.toMatch(/\bSort\b/);
  });
});
