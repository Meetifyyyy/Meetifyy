import { PrismaService } from './prisma.service';

/**
 * D-4 (migration 45): the 24 redundant indexes are gone, and every index that
 * covers them, and the nine prefix indexes the planner prefers, are still
 * there. Chosen from production and dev statistics (DATABASE_AUDIT.md §7.1).
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

/** Dropped index → the index that still serves its lookups. */
const DROPPED: Record<string, string> = {
  ConversationParticipant_conversationId_deletedAt_userId_idx:
    'idx_cp_convid_deletedat_userid',
  LegalDocumentVersion_documentType_versionNumber_idx:
    'LegalDocumentVersion_documentType_versionNumber_key',
  ActivityInvitation_activityId_inviteeId_idx:
    'ActivityInvitation_activityId_inviteeId_key',
  ActivityBookmark_userId_idx: 'ActivityBookmark_userId_activityId_key',
  ActivityInvitation_inviteeId_status_idx:
    'idx_activity_invitation_invitee_status',
  CampusEvent_createdBy_idx: 'CampusEvent_createdBy_idempotencyKey_key',
  CollegeDomain_collegeId_idx: 'CollegeDomain_collegeId_isPrimary_idx',
  CommentLike_userId_idx: 'CommentLike_pkey',
  CommunityMember_communityId_idx: 'CommunityMember_communityId_role_idx',
  ConversationJoinRequest_conversationId_idx:
    'ConversationJoinRequest_conversationId_userId_key',
  CrewActivity_status_idx: 'CrewActivity_status_createdAt_idx',
  CrewActivityMember_userId_idx: 'idx_crew_activity_member_status',
  CrewActivityMember_activityId_idx: 'CrewActivityMember_activityId_status_idx',
  DeletedMessage_userId_idx: 'DeletedMessage_userId_messageId_key',
  HelpArticle_status_idx: 'HelpArticle_status_isFeatured_idx',
  LegalAcknowledgement_userId_idx: 'LegalAcknowledgement_userId_versionId_key',
  Mention_userId_idx: 'Mention_userId_sourceType_sourceId_key',
  MessageReaction_messageId_idx: 'MessageReaction_messageId_userId_emoji_key',
  Mute_muterId_idx: 'Mute_muterId_targetType_targetId_key',
  Post_deletedAt_createdAt_idx: 'Post_deletedAt_createdAt_id_idx',
  PostBookmark_userId_idx: 'PostBookmark_userId_postId_key',
  PostShare_userId_idx: 'PostShare_userId_createdAt_idx',
  PostShare_postId_idx: 'PostShare_postId_userId_idx',
  User_collegeId_course_idx: 'User_collegeId_course_branch_idx',
};

/** Prefix indexes production showed the planner choosing: kept. */
const KEPT = [
  'Block_blockerId_idx',
  'Follow_followerId_idx',
  'Follow_followingId_idx',
  'PostLike_userId_idx',
  'CommunityMember_userId_idx',
  'Post_authorId_idx',
  'VerificationRequest_status_idx',
  'Comment_postId_idx',
  'User_collegeId_idx',
];

describeDb('Redundant indexes (database)', () => {
  let names: Set<string>;

  beforeAll(async () => {
    const prisma = new PrismaService();
    await prisma.$connect();
    const rows = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT indexname::text AS name FROM pg_indexes WHERE schemaname = 'public'`;
    names = new Set(rows.map((r) => r.name));
    await prisma.$disconnect();
  });

  it('drops all 24', () => {
    expect(Object.keys(DROPPED)).toHaveLength(24);
    expect(Object.keys(DROPPED).filter((n) => names.has(n))).toEqual([]);
  });

  it('keeps the index that covers each one', () => {
    expect(Object.values(DROPPED).filter((n) => !names.has(n))).toEqual([]);
  });

  it('keeps the prefix indexes the planner prefers', () => {
    expect(KEPT.filter((n) => !names.has(n))).toEqual([]);
  });
});
