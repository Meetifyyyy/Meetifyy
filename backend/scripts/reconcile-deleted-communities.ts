import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Starting backfill & reconciliation for soft-deleted communities...');

  const now = new Date();

  // 1. Find all soft-deleted communities
  const deletedCommunities = await prisma.community.findMany({
    where: { deletedAt: { not: null } },
    select: { id: true, name: true, deletedAt: true },
  });

  console.log(`Found ${deletedCommunities.length} soft-deleted communities.`);

  if (deletedCommunities.length === 0) {
    console.log('✅ No soft-deleted communities found. Database is clean!');
    return;
  }

  const communityIds = deletedCommunities.map((c) => c.id);

  // 2. Find all posts associated with these deleted communities
  const postsToSoftDelete = await prisma.post.findMany({
    where: {
      communityId: { in: communityIds },
      deletedAt: null,
    },
    select: { id: true, communityId: true },
  });

  console.log(`Found ${postsToSoftDelete.length} active posts belonging to soft-deleted communities.`);

  // 3. Find all post IDs for soft-deleted communities (both active and already deleted)
  const allCommunityPosts = await prisma.post.findMany({
    where: { communityId: { in: communityIds } },
    select: { id: true },
  });
  const allPostIds = allCommunityPosts.map((p) => p.id);

  console.log(`Total post IDs linked to deleted communities: ${allPostIds.length}`);

  await prisma.$transaction(async (tx) => {
    // 1. Mark active posts in deleted communities as soft-deleted
    if (allPostIds.length > 0) {
      const postsRes = await tx.post.updateMany({
        where: { id: { in: allPostIds }, deletedAt: null },
        data: { deletedAt: now },
      });
      console.log(`Updated ${postsRes.count} posts to deletedAt = now()`);

      // 2. Soft-delete comments on those posts
      const commentsRes = await tx.comment.updateMany({
        where: { postId: { in: allPostIds }, deletedAt: null },
        data: { deletedAt: now, isDeleted: true },
      });
      console.log(`Updated ${commentsRes.count} comments to deletedAt = now()`);

      // 3. Clean up post likes, bookmarks, shares, hashtags, mentions, poll votes & options
      const likesRes = await tx.postLike.deleteMany({ where: { postId: { in: allPostIds } } });
      console.log(`Deleted ${likesRes.count} PostLikes`);

      const bookmarksRes = await tx.postBookmark.deleteMany({ where: { postId: { in: allPostIds } } });
      console.log(`Deleted ${bookmarksRes.count} PostBookmarks`);

      const sharesRes = await tx.postShare.deleteMany({ where: { postId: { in: allPostIds } } });
      console.log(`Deleted ${sharesRes.count} PostShares`);

      const hashtagsRes = await tx.postHashtag.deleteMany({ where: { postId: { in: allPostIds } } });
      console.log(`Deleted ${hashtagsRes.count} PostHashtags`);

      const mentionsRes = await tx.mention.deleteMany({ where: { sourceId: { in: allPostIds } } });
      console.log(`Deleted ${mentionsRes.count} Mentions`);

      const pollVotesRes = await tx.pollVote.deleteMany({ where: { postId: { in: allPostIds } } });
      console.log(`Deleted ${pollVotesRes.count} PollVotes`);

      const pollOptionsRes = await tx.pollOption.deleteMany({ where: { postId: { in: allPostIds } } });
      console.log(`Deleted ${pollOptionsRes.count} PollOptions`);

      const notifsRes = await tx.notification.deleteMany({ where: { entityId: { in: allPostIds } } });
      console.log(`Deleted ${notifsRes.count} Notifications`);
    }

    // 4. Resolve reports for deleted communities & their posts
    const reportsRes = await tx.report.updateMany({
      where: {
        targetId: { in: [...communityIds, ...allPostIds] },
      },
      data: { status: 'RESOLVED', actionTaken: 'Community deleted' },
    });
    console.log(`Updated ${reportsRes.count} Reports to RESOLVED`);

    // 5. Remove community member records for deleted communities
    const membersRes = await tx.communityMember.deleteMany({
      where: { communityId: { in: communityIds } },
    });
    console.log(`Deleted ${membersRes.count} CommunityMember records`);

    // 6. Reset memberCount to 0 for deleted communities
    const commRes = await tx.community.updateMany({
      where: { id: { in: communityIds } },
      data: { memberCount: 0 },
    });
    console.log(`Updated ${commRes.count} Communities memberCount to 0`);
  });

  console.log('✨ Reconciliation complete! Database state is fully clean.');
}

main()
  .catch((e) => {
    console.error('❌ Reconciliation script failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
