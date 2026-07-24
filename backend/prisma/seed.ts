import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  AccountStatus,
  CommunityRole,
  CrewActivityStatus,
  CrewMemberStatus,
  ConversationType,
  MessageType,
  NotificationType,
  ReportReason,
  ReportStatus,
  MuteTargetType,
  MentionSource,
  ReportTargetType,
  NotificationEntityType,
  ConversationRole,
} from '@prisma/client';

async function main() {
  console.log('Bootstrapping NestJS for seeding...');
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  console.log('Seeding database with fresh dummy data and new schema...');

  // 1. Clear existing data
  await prisma.pollVote.deleteMany();
  await prisma.pollOption.deleteMany();
  await prisma.messageReadReceipt.deleteMany();
  await prisma.messageReaction.deleteMany();
  await prisma.mention.deleteMany();
  await prisma.postHashtag.deleteMany();
  await prisma.hashtag.deleteMany();
  await prisma.mute.deleteMany();
  await prisma.block.deleteMany();
  await prisma.report.deleteMany();
  await prisma.postShare.deleteMany();
  await prisma.postBookmark.deleteMany();
  
  await prisma.notification.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.postLike.deleteMany();
  await prisma.post.deleteMany();
  await prisma.crewActivityMember.deleteMany();
  await prisma.crewActivity.deleteMany();
  await prisma.encryptedMessageTarget.deleteMany();
  await prisma.oneTimePreKey.deleteMany();
  await prisma.device.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversationParticipant.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.follow.deleteMany();
  await prisma.communityMember.deleteMany();
  await prisma.community.deleteMany();
  await prisma.userSettings.deleteMany();
  await prisma.media.deleteMany();
  await prisma.user.deleteMany();
  await prisma.college.deleteMany();

  console.log('Cleaned existing data.');

  // 1.5 Create College
  const college = await prisma.college.create({
    data: {
      name: 'GLA University',
      isVerified: true,
      isActive: true,
      domains: {
        create: [{ domain: 'gla.ac.in', isPrimary: true }],
      },
    }
  });

  // 2. Create Users
  const userA = await prisma.user.create({
    data: {
      id: 'mock-user-a',
      username: 'sarthak',
      displayName: 'Sarthak',
      email: 'sarthak@meetifyy.com',
      avatar: 'https://api.dicebear.com/7.x/adventurer/svg?seed=sarthak',
      bio: 'Full Stack Dev building Meetifyy!',
      collegeId: college.id,
      major: 'Computer Science',
      graduationYear: 2025,
      location: 'Mathura',
      accountStatus: AccountStatus.ACTIVE,
      emailVerified: true,
      profileCompleted: true,
    },
  });

  const userB = await prisma.user.create({
    data: {
      id: 'mock-user-b',
      username: 'alex',
      displayName: 'Alex',
      email: 'alex@meetifyy.com',
      avatar: 'https://api.dicebear.com/7.x/adventurer/svg?seed=alex',
      bio: 'Design enthusiast and coffee lover.',
      collegeId: college.id,
      major: 'Design',
      graduationYear: 2026,
      accountStatus: AccountStatus.ACTIVE,
    },
  });

  const userC = await prisma.user.create({
    data: {
      id: 'mock-user-c',
      username: 'jordan',
      displayName: 'Jordan',
      email: 'jordan@meetifyy.com',
      avatar: 'https://api.dicebear.com/7.x/adventurer/svg?seed=jordan',
      bio: 'Always down for a hackathon.',
      collegeId: college.id,
      major: 'Software Engineering',
      graduationYear: 2024,
      accountStatus: AccountStatus.ACTIVE,
    },
  });

  console.log('Created Users.');

  // 3. Create Communities
  const commTech = await prisma.community.create({
    data: {
      id: 'comm-tech',
      name: 'Tech Enthusiasts',
      slug: 'tech-enthusiasts',
      description: 'Discuss the latest in coding, hardware, and tech news.',
      memberCount: 3,
      ownerId: userA.id,
      members: {
        create: [
          { userId: userA.id, role: CommunityRole.ADMIN },
          { userId: userB.id, role: CommunityRole.MEMBER },
          { userId: userC.id, role: CommunityRole.MEMBER },
        ],
      },
    },
  });

  const commArt = await prisma.community.create({
    data: {
      id: 'comm-art',
      name: 'Creative Minds',
      slug: 'creative-minds',
      description: 'Share your art, design, and creative projects.',
      memberCount: 2,
      ownerId: userB.id,
      members: {
        create: [
          { userId: userB.id, role: CommunityRole.ADMIN },
          { userId: userA.id, role: CommunityRole.MEMBER },
        ],
      },
    },
  });

  console.log('Created Communities.');

  // 4. Create Crew Activities
  await prisma.crewActivity.create({
    data: {
      id: 'activity-1',
      creatorId: userA.id,
      title: 'Late Night Coding Session',
      description: 'Working on a side project, anyone want to join for some pair programming?',
      
      maxMembers: 4,
      location: 'Library 2nd Floor',
      status: CrewActivityStatus.OPEN,
      members: {
        create: [
          { userId: userA.id, status: CrewMemberStatus.MEMBER },
          { userId: userC.id, status: CrewMemberStatus.MEMBER },
        ],
      },
    },
  });

  await prisma.crewActivity.create({
    data: {
      id: 'activity-2',
      creatorId: userB.id,
      title: 'Coffee & UI Review',
      description: 'Reviewing some Figma mocks over coffee.',
      
      maxMembers: 3,
      location: 'Campus Cafe',
      status: CrewActivityStatus.OPEN,
      members: {
        create: [
          { userId: userB.id, status: CrewMemberStatus.MEMBER },
          { userId: userA.id, status: CrewMemberStatus.PENDING },
        ],
      },
    },
  });

  console.log('Created Crew Activities.');

  // 5. Create Posts and new features
  const post1 = await prisma.post.create({
    data: {
      id: 'post-1',
      authorId: userA.id,
      text: 'Just finished setting up the new database schema! It feels so much cleaner now. #backend #prisma',
      communityId: commTech.id,
    }
  });

  // Hashtags
  const hashtag1 = await prisma.hashtag.create({ data: { name: 'backend', postCount: 1 } });
  const hashtag2 = await prisma.hashtag.create({ data: { name: 'prisma', postCount: 1 } });
  await prisma.postHashtag.create({ data: { postId: post1.id, hashtagId: hashtag1.id } });
  await prisma.postHashtag.create({ data: { postId: post1.id, hashtagId: hashtag2.id } });

  // Polls
  const post2 = await prisma.post.create({
    data: {
      id: 'post-2',
      authorId: userC.id,
      text: 'What framework should we use for the new web app?',
    }
  });
  const option1 = await prisma.pollOption.create({ data: { postId: post2.id, text: 'React', voteCount: 1 } });
  const option2 = await prisma.pollOption.create({ data: { postId: post2.id, text: 'Vue', voteCount: 0 } });
  await prisma.pollVote.create({ data: { postId: post2.id, optionId: option1.id, userId: userA.id } });

  // Bookmarks
  await prisma.postBookmark.create({ data: { userId: userB.id, postId: post1.id } });

  // Blocks/Mutes
  await prisma.mute.create({ data: { muterId: userA.id, targetType: MuteTargetType.USER, targetId: 'mock-user-b' } });
  
  // Conversations
  const conv = await prisma.conversation.create({
    data: {
      type: ConversationType.DM,
      participants: {
        create: [
          { userId: userA.id, role: ConversationRole.MEMBER },
          { userId: userB.id, role: ConversationRole.MEMBER },
        ]
      }
    }
  });

  const msg = await prisma.message.create({
    data: {
      conversationId: conv.id,
      senderId: userA.id,
      type: MessageType.CHAT,
      payload: { text: "Hey!" } // fallback for unencrypted payload just for testing
    }
  });
  
  await prisma.messageReaction.create({ data: { messageId: msg.id, userId: userB.id, emoji: '👋' }});

  console.log('Created Posts, Polls, Bookmarks, and Conversations.');

  await app.close();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
