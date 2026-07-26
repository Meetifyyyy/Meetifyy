import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting backfill of activity conversations...');

  // 1. Fetch all conversations with publicId or id starting with act_
  const conversations = await prisma.conversation.findMany();
  console.log(`Total conversations found: ${conversations.length}`);

  let updatedCount = 0;

  for (const conv of conversations) {
    const pubId = conv.publicId || '';
    const convId = conv.id || '';

    let actId: string | null = null;
    if (pubId.startsWith('act_')) {
      actId = pubId.replace(/^act_/, '');
    } else if (convId.startsWith('act_')) {
      actId = convId.replace(/^act_/, '');
    }

    if (!actId) {
      // Check if actId matches a CrewActivity directly
      const matchingActivity = await prisma.crewActivity.findUnique({
        where: { id: convId }
      });
      if (matchingActivity) {
        actId = matchingActivity.id;
      }
    }

    if (actId) {
      const activityExists = await prisma.crewActivity.findUnique({
        where: { id: actId }
      });

      if (activityExists) {
        await prisma.conversation.update({
          where: { id: conv.id },
          data: {
            type: 'ACTIVITY' as any,
            isActivityChat: true,
            activityId: actId
          }
        }).catch((err) => {
          console.error(`Failed to update conversation ${conv.id} for activity ${actId}:`, err.message);
        });
        console.log(`Updated conversation ${conv.id} -> type: ACTIVITY, activityId: ${actId}`);
        updatedCount++;
      }
    }
  }

  // 2. Also ensure all CrewActivities that have createActivityGroup = true have an associated conversation
  const activitiesWithGroup = await prisma.crewActivity.findMany({
    where: { createActivityGroup: true, deletedAt: null },
    include: { conversation: true }
  });

  console.log(`Found ${activitiesWithGroup.length} activities with createActivityGroup = true`);

  for (const act of activitiesWithGroup) {
    if (!act.conversation) {
      // Check if there is any conversation with activityId = act.id or publicId = act_act.id
      const existingConv = await prisma.conversation.findFirst({
        where: {
          OR: [
            { activityId: act.id },
            { publicId: `act_${act.id}` },
            { id: act.id }
          ]
        }
      });

      if (existingConv) {
        await prisma.conversation.update({
          where: { id: existingConv.id },
          data: {
            type: 'ACTIVITY' as any,
            isActivityChat: true,
            activityId: act.id
          }
        });
        console.log(`Linked existing conversation ${existingConv.id} to activity ${act.id}`);
      } else {
        // Create an activity conversation
        const members = await prisma.crewActivityMember.findMany({
          where: { activityId: act.id }
        });

        const participantCreate = [
          { userId: act.creatorId, role: 'OWNER' as const },
          ...members
            .filter(m => m.userId !== act.creatorId)
            .map(m => ({ userId: m.userId, role: 'MEMBER' as const }))
        ];

        const newConv = await prisma.conversation.create({
          data: {
            publicId: `act_${act.id}`,
            name: act.title,
            type: 'ACTIVITY' as any,
            isActivityChat: true,
            activityId: act.id,
            ownerId: act.creatorId,
            participants: {
              create: participantCreate
            }
          }
        });
        console.log(`Created new activity conversation ${newConv.id} for activity ${act.id}`);
      }
    }
  }

  console.log(`Backfill completed successfully. ${updatedCount} existing conversations updated.`);
}

main()
  .catch((e) => {
    console.error('Error running backfill script:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
