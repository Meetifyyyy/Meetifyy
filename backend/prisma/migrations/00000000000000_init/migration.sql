-- CreateEnum
CREATE TYPE "UserOtpPurpose" AS ENUM ('ACCOUNT_DELETION', 'ACCOUNT_RECOVERY');

-- CreateEnum
CREATE TYPE "DomainStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "CollegeStatus" AS ENUM ('PENDING', 'APPROVED', 'DISABLED');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED', 'PENDING_DELETION', 'DELETED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('LIKE', 'COMMENT', 'FOLLOW', 'MENTION', 'JOIN_REQUEST', 'SYSTEM', 'COMMENT_LIKE', 'MESSAGE', 'GROUP_INVITE', 'ACTIVITY_INVITE');

-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('DM', 'GROUP', 'INSTANT_MATCH');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('CHAT', 'SYSTEM', 'MEDIA');

-- CreateEnum
CREATE TYPE "CommunityRole" AS ENUM ('OWNER', 'MODERATOR', 'MEMBER');

-- CreateEnum
CREATE TYPE "CampusEventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CrewActivityStatus" AS ENUM ('OPEN', 'FULL', 'CANCELLED', 'ENDED');

-- CreateEnum
CREATE TYPE "ActivityVisibility" AS ENUM ('PUBLIC', 'COLLEGE_ONLY', 'PRIVATE');

-- CreateEnum
CREATE TYPE "CrewMemberStatus" AS ENUM ('MEMBER', 'PENDING', 'DECLINED');

-- CreateEnum
CREATE TYPE "CrewParticipationType" AS ENUM ('OPEN', 'APPROVAL');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('SPAM', 'HARASSMENT', 'HATE_SPEECH', 'VIOLENCE', 'IMPERSONATION', 'NUDITY', 'SCAM', 'MISINFORMATION', 'ILLEGAL_CONTENT', 'COPYRIGHT', 'FAKE_ACCOUNT', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReportPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "MuteTargetType" AS ENUM ('USER', 'COMMUNITY', 'CONVERSATION', 'ACTIVITY');

-- CreateEnum
CREATE TYPE "MentionSource" AS ENUM ('POST', 'COMMENT', 'MESSAGE');

-- CreateEnum
CREATE TYPE "ReportTargetType" AS ENUM ('USER', 'POST', 'COMMENT', 'ACTIVITY', 'COMMUNITY', 'MESSAGE', 'GROUP');

-- CreateEnum
CREATE TYPE "NotificationEntityType" AS ENUM ('POST', 'COMMENT', 'COMMUNITY', 'ACTIVITY', 'MESSAGE');

-- CreateEnum
CREATE TYPE "ConversationRole" AS ENUM ('MEMBER', 'ADMIN', 'OWNER');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InstantMatchChatStatus" AS ENUM ('ACTIVE', 'ENDED_BY_USER', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SupportCategory" AS ENUM ('ACCOUNT_LOGIN', 'PROFILE_PRIVACY', 'CHAT_MESSAGING', 'COMMUNITIES', 'POSTS_CONTENT', 'EVENTS_ACTIVITIES', 'NOTIFICATIONS', 'SAFETY_REPORTING', 'TECHNICAL', 'OTHER', 'SUSPENSION_APPEAL', 'BUG', 'ACCOUNT', 'VERIFICATION', 'ABUSE', 'FEATURE_REQUEST');

-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "SupportAuthorType" AS ENUM ('USER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "HelpContentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AnnouncementTarget" AS ENUM ('ALL', 'COLLEGE', 'VERIFIED', 'NEW_USERS', 'SPECIFIC');

-- CreateEnum
CREATE TYPE "AnnouncementMethod" AS ENUM ('IN_APP', 'EMAIL');

-- CreateEnum
CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MessageState" AS ENUM ('NORMAL', 'UNSENT', 'EDITED');

-- CreateEnum
CREATE TYPE "ActivityInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'RESUBMISSION_REQUIRED');

-- CreateEnum
CREATE TYPE "CommunityRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateTable
CREATE TABLE "College" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "slug" TEXT,
    "logoKey" TEXT,
    "logoMediaId" TEXT,
    "bannerKey" TEXT,
    "bannerMediaId" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "status" "CollegeStatus" NOT NULL DEFAULT 'APPROVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "College_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollegeDomain" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "collegeId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isVerified" BOOLEAN NOT NULL DEFAULT true,
    "status" "DomainStatus" NOT NULL DEFAULT 'ACTIVE',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollegeDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailNotifs" BOOLEAN NOT NULL DEFAULT true,
    "pushNotifs" BOOLEAN NOT NULL DEFAULT false,
    "privateProfile" BOOLEAN NOT NULL DEFAULT false,
    "showOnlineStatus" BOOLEAN NOT NULL DEFAULT true,
    "showLastSeen" BOOLEAN NOT NULL DEFAULT true,
    "whoCanSeeOnline" TEXT NOT NULL DEFAULT 'everyone',
    "whoCanSeeLastSeen" TEXT NOT NULL DEFAULT 'everyone',
    "readReceipts" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "likes" BOOLEAN NOT NULL DEFAULT true,
    "comments" BOOLEAN NOT NULL DEFAULT true,
    "mentions" BOOLEAN NOT NULL DEFAULT true,
    "messages" BOOLEAN NOT NULL DEFAULT true,
    "activities" BOOLEAN NOT NULL DEFAULT true,
    "groups" BOOLEAN NOT NULL DEFAULT true,
    "system" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Media" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'supabase',
    "bucket" TEXT NOT NULL DEFAULT 'meetifyy-dev',
    "objectKey" TEXT NOT NULL,
    "storageKey" TEXT,
    "type" TEXT,
    "mimeType" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "duration" INTEGER,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "order" INTEGER NOT NULL DEFAULT 0,
    "ownerId" TEXT,
    "postId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "bio" TEXT,
    "course" TEXT,
    "branch" TEXT,
    "passingYear" INTEGER,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "avatar" TEXT,
    "avatarMediaId" TEXT,
    "collegeEmail" TEXT,
    "collegeId" TEXT,
    "cover" TEXT,
    "coverMediaId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "birthday" TEXT,
    "interests" TEXT[],
    "lastSeenAt" TIMESTAMP(3),
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "profileCompleted" BOOLEAN NOT NULL DEFAULT false,
    "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "deletionRequestedAt" TIMESTAMP(3),
    "scheduledPurgeAt" TIMESTAMP(3),
    "purgeStartedAt" TIMESTAMP(3),
    "purgeCompletedAt" TIMESTAMP(3),
    "purgeAttempts" INTEGER NOT NULL DEFAULT 0,
    "purgeLastError" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "canPost" BOOLEAN NOT NULL DEFAULT true,
    "canMessage" BOOLEAN NOT NULL DEFAULT true,
    "canActivity" BOOLEAN NOT NULL DEFAULT true,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "isCampusRep" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "communityId" TEXT,
    "text" VARCHAR(2000) NOT NULL,
    "mentions" JSONB,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostLike" (
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostLike_pkey" PRIMARY KEY ("userId","postId")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" VARCHAR(500) NOT NULL,
    "mentions" JSONB,
    "parentId" TEXT,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedByUser" BOOLEAN NOT NULL DEFAULT false,
    "removalReason" VARCHAR(200),
    "removedByOwner" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommentLike" (
    "userId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommentLike_pkey" PRIMARY KEY ("userId","commentId")
);

-- CreateTable
CREATE TABLE "Community" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "avatarKey" TEXT,
    "avatarMediaId" TEXT,
    "coverKey" TEXT,
    "coverMediaId" TEXT,
    "color" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "collegeId" TEXT,
    "isCampusCommunity" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Community_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityMember" (
    "userId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role" "CommunityRole" NOT NULL DEFAULT 'MEMBER',
    "moderatorPromotedAt" TIMESTAMP(3),
    "moderatorNoticeAckedAt" TIMESTAMP(3),

    CONSTRAINT "CommunityMember_pkey" PRIMARY KEY ("userId","communityId")
);

-- CreateTable
CREATE TABLE "Follow" (
    "followerId" TEXT NOT NULL,
    "followingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("followerId","followingId")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "publicId" TEXT,
    "name" TEXT,
    "avatarKey" TEXT,
    "avatarMediaId" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allowSharing" BOOLEAN NOT NULL DEFAULT true,
    "editGroupPermission" TEXT NOT NULL DEFAULT 'ADMIN',
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "whoCanJoin" TEXT NOT NULL DEFAULT 'ANYONE',
    "description" TEXT,
    "inviteCode" TEXT,
    "inviteLink" TEXT,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "pinnedMessageId" TEXT,
    "isInstantMatch" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastMessageId" TEXT,
    "lastMessageText" TEXT,
    "lastMessageType" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "lastMessageSenderId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "type" "ConversationType" NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationParticipant" (
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role" "ConversationRole" NOT NULL DEFAULT 'MEMBER',
    "lastReadAt" TIMESTAMP(3),
    "isMuted" BOOLEAN NOT NULL DEFAULT false,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "pinnedAt" TIMESTAMP(3),
    "groupUpdatesActive" BOOLEAN NOT NULL DEFAULT true,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "clearedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("userId","conversationId")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "clientMessageId" TEXT,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "editedAt" TIMESTAMP(3),
    "payload" JSONB,
    "replyToId" TEXT,
    "type" "MessageType" NOT NULL DEFAULT 'CHAT',
    "state" "MessageState" NOT NULL DEFAULT 'NORMAL',
    "attachmentMediaId" TEXT,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrewActivity" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "maxMembers" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "coverImage" TEXT,
    "coverMediaId" TEXT,
    "coverColor" TEXT,
    "deletedAt" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "startDate" TIMESTAMP(3),
    "status" "CrewActivityStatus" NOT NULL DEFAULT 'OPEN',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "hostCollege" TEXT,
    "collegeId" TEXT,
    "participationType" "CrewParticipationType" NOT NULL DEFAULT 'OPEN',
    "shareToCampus" BOOLEAN NOT NULL DEFAULT false,
    "visibility" "ActivityVisibility" NOT NULL DEFAULT 'PUBLIC',

    CONSTRAINT "CrewActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrewActivityMember" (
    "userId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "CrewMemberStatus" NOT NULL DEFAULT 'MEMBER',

    CONSTRAINT "CrewActivityMember_pkey" PRIMARY KEY ("userId","activityId")
);

-- CreateTable
CREATE TABLE "ActivityDiscussionMessage" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityDiscussionMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampusEvent" (
    "id" TEXT NOT NULL,
    "campusId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" VARCHAR(4000),
    "posterUrl" TEXT,
    "posterMediaId" TEXT,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "hostedBy" TEXT NOT NULL,
    "venue" TEXT,
    "registrationUrl" TEXT,
    "createdBy" TEXT NOT NULL,
    "status" "CampusEventStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CampusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "NotificationType" NOT NULL,
    "entityType" "NotificationEntityType",
    "body" TEXT,
    "deletedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "metadata" JSONB,
    "readAt" TIMESTAMP(3),
    "recipientId" TEXT NOT NULL,
    "title" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostBookmark" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostBookmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityBookmark" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityBookmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostShare" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Block" (
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("blockerId","blockedId")
);

-- CreateTable
CREATE TABLE "Mute" (
    "id" TEXT NOT NULL,
    "muterId" TEXT NOT NULL,
    "targetType" "MuteTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hashtag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "postCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Hashtag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostHashtag" (
    "postId" TEXT NOT NULL,
    "hashtagId" TEXT NOT NULL,

    CONSTRAINT "PostHashtag_pkey" PRIMARY KEY ("postId","hashtagId")
);

-- CreateTable
CREATE TABLE "Mention" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" "MentionSource" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageReaction" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollOption" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "voteCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PollOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollVote" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetType" "ReportTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "description" VARCHAR(500),
    "metadata" JSONB,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "ReportPriority" NOT NULL DEFAULT 'MEDIUM',
    "assignedModeratorId" TEXT,
    "internalNotes" VARCHAR(2000),
    "actionTaken" VARCHAR(500),
    "resolution" VARCHAR(500),
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchQueueEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "campus" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "timePreference" TEXT NOT NULL,
    "optionalDetail" TEXT,
    "area" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchQueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchSession" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "aAccepted" BOOLEAN NOT NULL DEFAULT false,
    "bAccepted" BOOLEAN NOT NULL DEFAULT false,
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "chatStatus" "InstantMatchChatStatus" NOT NULL DEFAULT 'ACTIVE',
    "chatExpiresAt" TIMESTAMP(3),
    "endedById" TEXT,
    "endedAt" TIMESTAMP(3),
    "matchReason" TEXT,
    "snapshotA" JSONB,
    "snapshotB" JSONB,

    CONSTRAINT "MatchSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuperAdmin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuperAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuperAdminSession" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "refreshHash" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "deviceName" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "revokedReason" TEXT,

    CONSTRAINT "SuperAdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserOtp" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "UserOtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestIp" TEXT,

    CONSTRAINT "UserOtp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminOtp" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminOtp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminRecoveryCode" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAudit" (
    "id" TEXT NOT NULL,
    "adminId" TEXT,
    "email" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "deviceName" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "ip" TEXT,
    "endpoint" TEXT,
    "httpMethod" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "ip" TEXT,
    "adminId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "ticketNumber" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "category" "SupportCategory" NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "description" VARCHAR(10000) NOT NULL,
    "attachments" JSONB,
    "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "SupportPriority" NOT NULL DEFAULT 'NORMAL',
    "assignedAdminId" TEXT,
    "browserInfo" JSONB,
    "pageContext" TEXT,
    "ipHash" TEXT,
    "emailStatus" "EmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "emailError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorType" "SupportAuthorType" NOT NULL DEFAULT 'USER',
    "senderId" TEXT,
    "authorAdminId" TEXT,
    "body" VARCHAR(10000) NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "attachments" JSONB,
    "emailStatus" "EmailDeliveryStatus",
    "emailMessageId" TEXT,
    "emailError" TEXT,
    "emailSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "HelpContentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "HelpCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpArticle" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "question" VARCHAR(300) NOT NULL,
    "summary" VARCHAR(500),
    "body" TEXT NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "status" "HelpContentStatus" NOT NULL DEFAULT 'DRAFT',
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "HelpArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollegeRequest" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "collegeName" TEXT NOT NULL,
    "personalEmail" TEXT,
    "collegeEmail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollegeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" VARCHAR(10000) NOT NULL,
    "target" "AnnouncementTarget" NOT NULL DEFAULT 'ALL',
    "collegeId" TEXT,
    "method" "AnnouncementMethod" NOT NULL DEFAULT 'IN_APP',
    "status" "AnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationJoinRequest" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ConversationJoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeletedMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeletedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityInvitation" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteeId" TEXT NOT NULL,
    "status" "ActivityInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ActivityInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityJoinRequest" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "CommunityRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityJoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecentSearch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecentSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "selfieMediaId" TEXT NOT NULL,
    "idCardMediaId" TEXT NOT NULL,
    "rejectionReason" VARCHAR(500),
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlowRequest" (
    "id" TEXT NOT NULL,
    "route" VARCHAR(300) NOT NULL,
    "path" VARCHAR(500) NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "requestId" VARCHAR(100),
    "userId" VARCHAR(64),
    "adminId" VARCHAR(64),
    "ip" VARCHAR(64),
    "userAgent" VARCHAR(300),
    "bytesOut" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlowRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "College_slug_key" ON "College"("slug");

-- CreateIndex
CREATE INDEX "College_status_idx" ON "College"("status");

-- CreateIndex
CREATE INDEX "College_isActive_idx" ON "College"("isActive");

-- CreateIndex
CREATE INDEX "College_deletedAt_idx" ON "College"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CollegeDomain_domain_key" ON "CollegeDomain"("domain");

-- CreateIndex
CREATE INDEX "CollegeDomain_collegeId_idx" ON "CollegeDomain"("collegeId");

-- CreateIndex
CREATE INDEX "CollegeDomain_collegeId_isPrimary_idx" ON "CollegeDomain"("collegeId", "isPrimary");

-- CreateIndex
CREATE INDEX "CollegeDomain_status_idx" ON "CollegeDomain"("status");

-- CreateIndex
CREATE INDEX "CollegeDomain_domain_status_idx" ON "CollegeDomain"("domain", "status");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreferences_userId_key" ON "NotificationPreferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Media_objectKey_key" ON "Media"("objectKey");

-- CreateIndex
CREATE INDEX "Media_postId_idx" ON "Media"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_collegeId_idx" ON "User"("collegeId");

-- CreateIndex
CREATE INDEX "User_collegeId_createdAt_idx" ON "User"("collegeId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "User_collegeId_course_idx" ON "User"("collegeId", "course");

-- CreateIndex
CREATE INDEX "User_collegeId_course_branch_idx" ON "User"("collegeId", "course", "branch");

-- CreateIndex
CREATE INDEX "User_collegeId_passingYear_idx" ON "User"("collegeId", "passingYear");

-- CreateIndex
CREATE INDEX "User_deletedAt_createdAt_idx" ON "User"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "User_lastSeenAt_idx" ON "User"("lastSeenAt");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "User_collegeId_isCampusRep_idx" ON "User"("collegeId", "isCampusRep");

-- CreateIndex
CREATE INDEX "User_accountStatus_createdAt_idx" ON "User"("accountStatus", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "User_accountStatus_scheduledPurgeAt_idx" ON "User"("accountStatus", "scheduledPurgeAt");

-- CreateIndex
CREATE INDEX "User_collegeEmail_idx" ON "User"("collegeEmail");

-- CreateIndex
CREATE INDEX "Post_authorId_idx" ON "Post"("authorId");

-- CreateIndex
CREATE INDEX "Post_createdAt_idx" ON "Post"("createdAt");

-- CreateIndex
CREATE INDEX "Post_deletedAt_createdAt_idx" ON "Post"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Post_authorId_deletedAt_createdAt_idx" ON "Post"("authorId", "deletedAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Post_deletedAt_createdAt_authorId_idx" ON "Post"("deletedAt", "createdAt" DESC, "authorId");

-- CreateIndex
CREATE INDEX "Post_deletedAt_createdAt_id_idx" ON "Post"("deletedAt", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Post_communityId_deletedAt_createdAt_idx" ON "Post"("communityId", "deletedAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "PostLike_userId_idx" ON "PostLike"("userId");

-- CreateIndex
CREATE INDEX "PostLike_postId_idx" ON "PostLike"("postId");

-- CreateIndex
CREATE INDEX "Comment_postId_idx" ON "Comment"("postId");

-- CreateIndex
CREATE INDEX "Comment_postId_createdAt_idx" ON "Comment"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_authorId_idx" ON "Comment"("authorId");

-- CreateIndex
CREATE INDEX "Comment_isDeleted_postId_idx" ON "Comment"("isDeleted", "postId");

-- CreateIndex
CREATE INDEX "Comment_deletedAt_createdAt_idx" ON "Comment"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "CommentLike_userId_idx" ON "CommentLike"("userId");

-- CreateIndex
CREATE INDEX "CommentLike_commentId_idx" ON "CommentLike"("commentId");

-- CreateIndex
CREATE UNIQUE INDEX "Community_slug_key" ON "Community"("slug");

-- CreateIndex
CREATE INDEX "Community_ownerId_idx" ON "Community"("ownerId");

-- CreateIndex
CREATE INDEX "Community_deletedAt_memberCount_idx" ON "Community"("deletedAt", "memberCount" DESC);

-- CreateIndex
CREATE INDEX "Community_deletedAt_isCampusCommunity_memberCount_idx" ON "Community"("deletedAt", "isCampusCommunity", "memberCount" DESC);

-- CreateIndex
CREATE INDEX "Community_collegeId_isCampusCommunity_deletedAt_memberCount_idx" ON "Community"("collegeId", "isCampusCommunity", "deletedAt", "memberCount" DESC);

-- CreateIndex
CREATE INDEX "CommunityMember_userId_idx" ON "CommunityMember"("userId");

-- CreateIndex
CREATE INDEX "CommunityMember_communityId_idx" ON "CommunityMember"("communityId");

-- CreateIndex
CREATE INDEX "CommunityMember_communityId_role_idx" ON "CommunityMember"("communityId", "role");

-- CreateIndex
CREATE INDEX "Follow_followerId_idx" ON "Follow"("followerId");

-- CreateIndex
CREATE INDEX "Follow_followingId_idx" ON "Follow"("followingId");

-- CreateIndex
CREATE INDEX "Follow_followingId_createdAt_idx" ON "Follow"("followingId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Follow_followerId_createdAt_idx" ON "Follow"("followerId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_publicId_key" ON "Conversation"("publicId");

-- CreateIndex
CREATE INDEX "Conversation_ownerId_idx" ON "Conversation"("ownerId");

-- CreateIndex
CREATE INDEX "Conversation_updatedAt_idx" ON "Conversation"("updatedAt" DESC);

-- CreateIndex
CREATE INDEX "ConversationParticipant_userId_idx" ON "ConversationParticipant"("userId");

-- CreateIndex
CREATE INDEX "ConversationParticipant_conversationId_idx" ON "ConversationParticipant"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationParticipant_userId_deletedAt_idx" ON "ConversationParticipant"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "ConversationParticipant_userId_deletedAt_leftAt_idx" ON "ConversationParticipant"("userId", "deletedAt", "leftAt");

-- CreateIndex
CREATE INDEX "ConversationParticipant_conversationId_deletedAt_idx" ON "ConversationParticipant"("conversationId", "deletedAt");

-- CreateIndex
CREATE INDEX "ConversationParticipant_conversationId_deletedAt_userId_idx" ON "ConversationParticipant"("conversationId", "deletedAt", "userId");

-- CreateIndex
CREATE INDEX "ConversationParticipant_conversationId_deletedAt_leftAt_use_idx" ON "ConversationParticipant"("conversationId", "deletedAt", "leftAt", "userId");

-- CreateIndex
CREATE INDEX "ConversationParticipant_userId_isPinned_pinnedAt_idx" ON "ConversationParticipant"("userId", "isPinned", "pinnedAt" DESC);

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_id_idx" ON "Message"("conversationId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_senderId_idx" ON "Message"("conversationId", "createdAt", "senderId");

-- CreateIndex
CREATE INDEX "Message_conversationId_deletedAt_createdAt_idx" ON "Message"("conversationId", "deletedAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Message_conversationId_deletedAt_createdAt_id_idx" ON "Message"("conversationId", "deletedAt", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Message_senderId_idx" ON "Message"("senderId");

-- CreateIndex
CREATE INDEX "Message_senderId_clientMessageId_idx" ON "Message"("senderId", "clientMessageId");

-- CreateIndex
CREATE INDEX "CrewActivity_creatorId_idx" ON "CrewActivity"("creatorId");

-- CreateIndex
CREATE INDEX "CrewActivity_createdAt_idx" ON "CrewActivity"("createdAt");

-- CreateIndex
CREATE INDEX "CrewActivity_status_idx" ON "CrewActivity"("status");

-- CreateIndex
CREATE INDEX "CrewActivity_deletedAt_status_createdAt_idx" ON "CrewActivity"("deletedAt", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CrewActivity_status_createdAt_idx" ON "CrewActivity"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CrewActivity_collegeId_status_createdAt_idx" ON "CrewActivity"("collegeId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CrewActivity_visibility_status_createdAt_idx" ON "CrewActivity"("visibility", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CrewActivity_deletedAt_status_visibility_createdAt_idx" ON "CrewActivity"("deletedAt", "status", "visibility", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CrewActivity_status_deletedAt_endDate_startDate_idx" ON "CrewActivity"("status", "deletedAt", "endDate", "startDate");

-- CreateIndex
CREATE INDEX "CrewActivity_status_deletedAt_startDate_idx" ON "CrewActivity"("status", "deletedAt", "startDate");

-- CreateIndex
CREATE INDEX "CrewActivity_collegeId_status_deletedAt_startDate_idx" ON "CrewActivity"("collegeId", "status", "deletedAt", "startDate");

-- CreateIndex
CREATE INDEX "CrewActivity_maxMembers_status_deletedAt_startDate_idx" ON "CrewActivity"("maxMembers", "status", "deletedAt", "startDate");

-- CreateIndex
CREATE INDEX "CrewActivityMember_userId_idx" ON "CrewActivityMember"("userId");

-- CreateIndex
CREATE INDEX "CrewActivityMember_activityId_idx" ON "CrewActivityMember"("activityId");

-- CreateIndex
CREATE INDEX "CrewActivityMember_activityId_status_idx" ON "CrewActivityMember"("activityId", "status");

-- CreateIndex
CREATE INDEX "ActivityDiscussionMessage_activityId_createdAt_id_idx" ON "ActivityDiscussionMessage"("activityId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "ActivityDiscussionMessage_userId_idx" ON "ActivityDiscussionMessage"("userId");

-- CreateIndex
CREATE INDEX "CampusEvent_campusId_status_startTime_idx" ON "CampusEvent"("campusId", "status", "startTime");

-- CreateIndex
CREATE INDEX "CampusEvent_campusId_status_endTime_idx" ON "CampusEvent"("campusId", "status", "endTime");

-- CreateIndex
CREATE INDEX "CampusEvent_createdBy_idx" ON "CampusEvent"("createdBy");

-- CreateIndex
CREATE INDEX "CampusEvent_deletedAt_campusId_status_startTime_idx" ON "CampusEvent"("deletedAt", "campusId", "status", "startTime");

-- CreateIndex
CREATE INDEX "Notification_recipientId_readAt_idx" ON "Notification"("recipientId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_recipientId_deletedAt_readAt_idx" ON "Notification"("recipientId", "deletedAt", "readAt");

-- CreateIndex
CREATE INDEX "Notification_recipientId_deletedAt_createdAt_idx" ON "Notification"("recipientId", "deletedAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_recipientId_type_deletedAt_createdAt_idx" ON "Notification"("recipientId", "type", "deletedAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_recipientId_deletedAt_type_createdAt_idx" ON "Notification"("recipientId", "deletedAt", "type", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_type_idx" ON "Notification"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_recipientId_actorId_entityId_type_key" ON "Notification"("recipientId", "actorId", "entityId", "type");

-- CreateIndex
CREATE INDEX "PostBookmark_userId_idx" ON "PostBookmark"("userId");

-- CreateIndex
CREATE INDEX "PostBookmark_postId_idx" ON "PostBookmark"("postId");

-- CreateIndex
CREATE INDEX "PostBookmark_createdAt_idx" ON "PostBookmark"("createdAt");

-- CreateIndex
CREATE INDEX "PostBookmark_userId_createdAt_idx" ON "PostBookmark"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PostBookmark_userId_postId_key" ON "PostBookmark"("userId", "postId");

-- CreateIndex
CREATE INDEX "ActivityBookmark_userId_idx" ON "ActivityBookmark"("userId");

-- CreateIndex
CREATE INDEX "ActivityBookmark_activityId_idx" ON "ActivityBookmark"("activityId");

-- CreateIndex
CREATE INDEX "ActivityBookmark_createdAt_idx" ON "ActivityBookmark"("createdAt");

-- CreateIndex
CREATE INDEX "ActivityBookmark_userId_createdAt_idx" ON "ActivityBookmark"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ActivityBookmark_userId_activityId_key" ON "ActivityBookmark"("userId", "activityId");

-- CreateIndex
CREATE INDEX "PostShare_userId_idx" ON "PostShare"("userId");

-- CreateIndex
CREATE INDEX "PostShare_postId_idx" ON "PostShare"("postId");

-- CreateIndex
CREATE INDEX "PostShare_postId_userId_idx" ON "PostShare"("postId", "userId");

-- CreateIndex
CREATE INDEX "PostShare_userId_createdAt_idx" ON "PostShare"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Block_blockerId_idx" ON "Block"("blockerId");

-- CreateIndex
CREATE INDEX "Block_blockedId_idx" ON "Block"("blockedId");

-- CreateIndex
CREATE INDEX "Mute_muterId_idx" ON "Mute"("muterId");

-- CreateIndex
CREATE UNIQUE INDEX "Mute_muterId_targetType_targetId_key" ON "Mute"("muterId", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "Hashtag_name_key" ON "Hashtag"("name");

-- CreateIndex
CREATE INDEX "PostHashtag_hashtagId_idx" ON "PostHashtag"("hashtagId");

-- CreateIndex
CREATE INDEX "Mention_userId_idx" ON "Mention"("userId");

-- CreateIndex
CREATE INDEX "Mention_userId_createdAt_idx" ON "Mention"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Mention_sourceType_sourceId_idx" ON "Mention"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Mention_userId_sourceType_sourceId_key" ON "Mention"("userId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "MessageReaction_messageId_idx" ON "MessageReaction"("messageId");

-- CreateIndex
CREATE INDEX "MessageReaction_userId_idx" ON "MessageReaction"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageReaction_messageId_userId_emoji_key" ON "MessageReaction"("messageId", "userId", "emoji");

-- CreateIndex
CREATE INDEX "PollOption_postId_idx" ON "PollOption"("postId");

-- CreateIndex
CREATE INDEX "PollVote_optionId_idx" ON "PollVote"("optionId");

-- CreateIndex
CREATE INDEX "PollVote_userId_idx" ON "PollVote"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PollVote_postId_userId_key" ON "PollVote"("postId", "userId");

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_reporterId_idx" ON "Report"("reporterId");

-- CreateIndex
CREATE INDEX "Report_targetType_targetId_idx" ON "Report"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "Report_priority_status_idx" ON "Report"("priority", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MatchQueueEntry_userId_key" ON "MatchQueueEntry"("userId");

-- CreateIndex
CREATE INDEX "MatchQueueEntry_campus_activity_timePreference_expiresAt_idx" ON "MatchQueueEntry"("campus", "activity", "timePreference", "expiresAt");

-- CreateIndex
CREATE INDEX "MatchQueueEntry_expiresAt_idx" ON "MatchQueueEntry"("expiresAt");

-- CreateIndex
CREATE INDEX "MatchSession_userAId_idx" ON "MatchSession"("userAId");

-- CreateIndex
CREATE INDEX "MatchSession_userBId_idx" ON "MatchSession"("userBId");

-- CreateIndex
CREATE INDEX "MatchSession_status_expiresAt_idx" ON "MatchSession"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "MatchSession_chatStatus_chatExpiresAt_idx" ON "MatchSession"("chatStatus", "chatExpiresAt");

-- CreateIndex
CREATE INDEX "MatchSession_conversationId_idx" ON "MatchSession"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "SuperAdmin_email_key" ON "SuperAdmin"("email");

-- CreateIndex
CREATE UNIQUE INDEX "SuperAdminSession_refreshHash_key" ON "SuperAdminSession"("refreshHash");

-- CreateIndex
CREATE INDEX "SuperAdminSession_adminId_idx" ON "SuperAdminSession"("adminId");

-- CreateIndex
CREATE INDEX "SuperAdminSession_expiresAt_idx" ON "SuperAdminSession"("expiresAt");

-- CreateIndex
CREATE INDEX "SuperAdminSession_revoked_idx" ON "SuperAdminSession"("revoked");

-- CreateIndex
CREATE INDEX "UserOtp_expiresAt_idx" ON "UserOtp"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserOtp_userId_purpose_key" ON "UserOtp"("userId", "purpose");

-- CreateIndex
CREATE INDEX "AdminOtp_adminId_idx" ON "AdminOtp"("adminId");

-- CreateIndex
CREATE INDEX "AdminRecoveryCode_adminId_idx" ON "AdminRecoveryCode"("adminId");

-- CreateIndex
CREATE INDEX "LoginAudit_adminId_idx" ON "LoginAudit"("adminId");

-- CreateIndex
CREATE INDEX "LoginAudit_createdAt_idx" ON "LoginAudit"("createdAt");

-- CreateIndex
CREATE INDEX "LoginAudit_success_idx" ON "LoginAudit"("success");

-- CreateIndex
CREATE INDEX "AuditLog_adminId_idx" ON "AuditLog"("adminId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "SecurityEvent_type_idx" ON "SecurityEvent"("type");

-- CreateIndex
CREATE INDEX "SecurityEvent_createdAt_idx" ON "SecurityEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_ticketNumber_key" ON "SupportTicket"("ticketNumber");

-- CreateIndex
CREATE INDEX "SupportTicket_userId_idx" ON "SupportTicket"("userId");

-- CreateIndex
CREATE INDEX "SupportTicket_email_idx" ON "SupportTicket"("email");

-- CreateIndex
CREATE INDEX "SupportTicket_category_idx" ON "SupportTicket"("category");

-- CreateIndex
CREATE INDEX "SupportTicket_priority_idx" ON "SupportTicket"("priority");

-- CreateIndex
CREATE INDEX "SupportTicket_assignedAdminId_idx" ON "SupportTicket"("assignedAdminId");

-- CreateIndex
CREATE INDEX "SupportTicket_createdAt_idx" ON "SupportTicket"("createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_status_createdAt_idx" ON "SupportTicket"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SupportMessage_ticketId_createdAt_idx" ON "SupportMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HelpCategory_slug_key" ON "HelpCategory"("slug");

-- CreateIndex
CREATE INDEX "HelpCategory_status_sortOrder_idx" ON "HelpCategory"("status", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "HelpArticle_slug_key" ON "HelpArticle"("slug");

-- CreateIndex
CREATE INDEX "HelpArticle_categoryId_sortOrder_idx" ON "HelpArticle"("categoryId", "sortOrder");

-- CreateIndex
CREATE INDEX "HelpArticle_status_idx" ON "HelpArticle"("status");

-- CreateIndex
CREATE INDEX "HelpArticle_status_isFeatured_idx" ON "HelpArticle"("status", "isFeatured");

-- CreateIndex
CREATE INDEX "CollegeRequest_status_idx" ON "CollegeRequest"("status");

-- CreateIndex
CREATE INDEX "CollegeRequest_createdAt_idx" ON "CollegeRequest"("createdAt");

-- CreateIndex
CREATE INDEX "Announcement_status_idx" ON "Announcement"("status");

-- CreateIndex
CREATE INDEX "Announcement_scheduledAt_idx" ON "Announcement"("scheduledAt");

-- CreateIndex
CREATE INDEX "ConversationJoinRequest_conversationId_idx" ON "ConversationJoinRequest"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationJoinRequest_userId_idx" ON "ConversationJoinRequest"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationJoinRequest_conversationId_userId_key" ON "ConversationJoinRequest"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "DeletedMessage_userId_idx" ON "DeletedMessage"("userId");

-- CreateIndex
CREATE INDEX "DeletedMessage_messageId_idx" ON "DeletedMessage"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "DeletedMessage_userId_messageId_key" ON "DeletedMessage"("userId", "messageId");

-- CreateIndex
CREATE INDEX "ActivityInvitation_activityId_inviteeId_idx" ON "ActivityInvitation"("activityId", "inviteeId");

-- CreateIndex
CREATE INDEX "ActivityInvitation_activityId_inviteeId_status_idx" ON "ActivityInvitation"("activityId", "inviteeId", "status");

-- CreateIndex
CREATE INDEX "ActivityInvitation_inviteeId_status_idx" ON "ActivityInvitation"("inviteeId", "status");

-- CreateIndex
CREATE INDEX "ActivityInvitation_inviteeId_status_createdAt_idx" ON "ActivityInvitation"("inviteeId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ActivityInvitation_inviterId_idx" ON "ActivityInvitation"("inviterId");

-- CreateIndex
CREATE INDEX "ActivityInvitation_activityId_status_idx" ON "ActivityInvitation"("activityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityInvitation_activityId_inviteeId_key" ON "ActivityInvitation"("activityId", "inviteeId");

-- CreateIndex
CREATE INDEX "CommunityJoinRequest_communityId_status_idx" ON "CommunityJoinRequest"("communityId", "status");

-- CreateIndex
CREATE INDEX "CommunityJoinRequest_userId_idx" ON "CommunityJoinRequest"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityJoinRequest_communityId_userId_key" ON "CommunityJoinRequest"("communityId", "userId");

-- CreateIndex
CREATE INDEX "RecentSearch_userId_updatedAt_idx" ON "RecentSearch"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "RecentSearch_userId_term_key" ON "RecentSearch"("userId", "term");

-- CreateIndex
CREATE INDEX "VerificationRequest_status_idx" ON "VerificationRequest"("status");

-- CreateIndex
CREATE INDEX "VerificationRequest_status_createdAt_idx" ON "VerificationRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationRequest_userId_createdAt_idx" ON "VerificationRequest"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationRequest_userId_attemptNumber_key" ON "VerificationRequest"("userId", "attemptNumber");

-- CreateIndex
CREATE INDEX "SlowRequest_occurredAt_idx" ON "SlowRequest"("occurredAt");

-- CreateIndex
CREATE INDEX "SlowRequest_durationMs_idx" ON "SlowRequest"("durationMs");

-- CreateIndex
CREATE INDEX "SlowRequest_route_occurredAt_idx" ON "SlowRequest"("route", "occurredAt");

-- AddForeignKey
ALTER TABLE "College" ADD CONSTRAINT "College_bannerMediaId_fkey" FOREIGN KEY ("bannerMediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "College" ADD CONSTRAINT "College_logoMediaId_fkey" FOREIGN KEY ("logoMediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollegeDomain" ADD CONSTRAINT "CollegeDomain_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreferences" ADD CONSTRAINT "NotificationPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_avatarMediaId_fkey" FOREIGN KEY ("avatarMediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_coverMediaId_fkey" FOREIGN KEY ("coverMediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostLike" ADD CONSTRAINT "PostLike_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostLike" ADD CONSTRAINT "PostLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentLike" ADD CONSTRAINT "CommentLike_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentLike" ADD CONSTRAINT "CommentLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Community" ADD CONSTRAINT "Community_avatarMediaId_fkey" FOREIGN KEY ("avatarMediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Community" ADD CONSTRAINT "Community_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Community" ADD CONSTRAINT "Community_coverMediaId_fkey" FOREIGN KEY ("coverMediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Community" ADD CONSTRAINT "Community_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMember" ADD CONSTRAINT "CommunityMember_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMember" ADD CONSTRAINT "CommunityMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_avatarMediaId_fkey" FOREIGN KEY ("avatarMediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_pinnedMessageId_fkey" FOREIGN KEY ("pinnedMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_attachmentMediaId_fkey" FOREIGN KEY ("attachmentMediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewActivity" ADD CONSTRAINT "CrewActivity_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewActivity" ADD CONSTRAINT "CrewActivity_coverMediaId_fkey" FOREIGN KEY ("coverMediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewActivity" ADD CONSTRAINT "CrewActivity_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewActivityMember" ADD CONSTRAINT "CrewActivityMember_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "CrewActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewActivityMember" ADD CONSTRAINT "CrewActivityMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityDiscussionMessage" ADD CONSTRAINT "ActivityDiscussionMessage_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "CrewActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityDiscussionMessage" ADD CONSTRAINT "ActivityDiscussionMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampusEvent" ADD CONSTRAINT "CampusEvent_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "College"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampusEvent" ADD CONSTRAINT "CampusEvent_posterMediaId_fkey" FOREIGN KEY ("posterMediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampusEvent" ADD CONSTRAINT "CampusEvent_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostBookmark" ADD CONSTRAINT "PostBookmark_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostBookmark" ADD CONSTRAINT "PostBookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityBookmark" ADD CONSTRAINT "ActivityBookmark_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "CrewActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityBookmark" ADD CONSTRAINT "ActivityBookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostShare" ADD CONSTRAINT "PostShare_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostShare" ADD CONSTRAINT "PostShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mute" ADD CONSTRAINT "Mute_muterId_fkey" FOREIGN KEY ("muterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostHashtag" ADD CONSTRAINT "PostHashtag_hashtagId_fkey" FOREIGN KEY ("hashtagId") REFERENCES "Hashtag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostHashtag" ADD CONSTRAINT "PostHashtag_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollOption" ADD CONSTRAINT "PollOption_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "PollOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchQueueEntry" ADD CONSTRAINT "MatchQueueEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchSession" ADD CONSTRAINT "MatchSession_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchSession" ADD CONSTRAINT "MatchSession_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuperAdminSession" ADD CONSTRAINT "SuperAdminSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "SuperAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOtp" ADD CONSTRAINT "UserOtp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminOtp" ADD CONSTRAINT "AdminOtp_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "SuperAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminRecoveryCode" ADD CONSTRAINT "AdminRecoveryCode_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "SuperAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginAudit" ADD CONSTRAINT "LoginAudit_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "SuperAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "SuperAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "SuperAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpArticle" ADD CONSTRAINT "HelpArticle_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "HelpCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationJoinRequest" ADD CONSTRAINT "ConversationJoinRequest_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationJoinRequest" ADD CONSTRAINT "ConversationJoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeletedMessage" ADD CONSTRAINT "DeletedMessage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeletedMessage" ADD CONSTRAINT "DeletedMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityInvitation" ADD CONSTRAINT "ActivityInvitation_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "CrewActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityInvitation" ADD CONSTRAINT "ActivityInvitation_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityInvitation" ADD CONSTRAINT "ActivityInvitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityJoinRequest" ADD CONSTRAINT "CommunityJoinRequest_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityJoinRequest" ADD CONSTRAINT "CommunityJoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecentSearch" ADD CONSTRAINT "RecentSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "SuperAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_selfieMediaId_fkey" FOREIGN KEY ("selfieMediaId") REFERENCES "Media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_idCardMediaId_fkey" FOREIGN KEY ("idCardMediaId") REFERENCES "Media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

