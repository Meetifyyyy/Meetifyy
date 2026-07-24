ALTER TABLE "Community" ADD CONSTRAINT "Community_memberCount_check" CHECK ("memberCount" >= 0);
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_memberCount_check" CHECK ("memberCount" >= 0);
ALTER TABLE "Post" ADD CONSTRAINT "Post_likeCount_check" CHECK ("likeCount" >= 0);
ALTER TABLE "Post" ADD CONSTRAINT "Post_commentCount_check" CHECK ("commentCount" >= 0);
ALTER TABLE "PollOption" ADD CONSTRAINT "PollOption_voteCount_check" CHECK ("voteCount" >= 0);
ALTER TABLE "CrewActivity" ADD CONSTRAINT "CrewActivity_maxMembers_check" CHECK ("maxMembers" > 0);
