-- Help centre + guest-capable support requests.
--
-- SupportTicket previously modelled an authenticated-only ticket. The support
-- flow now has to work for a user who cannot log in, so `userId` becomes
-- nullable and the reporter's email/description move onto the ticket itself.
-- Existing rows are backfilled from their author and first message.

-- The fuzzy-search migration that first creates this extension sorts after this
-- one, so a fresh database would reach the trigram index below without it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------- enums ----
ALTER TYPE "SupportCategory" ADD VALUE IF NOT EXISTS 'ACCOUNT_LOGIN';
ALTER TYPE "SupportCategory" ADD VALUE IF NOT EXISTS 'PROFILE_PRIVACY';
ALTER TYPE "SupportCategory" ADD VALUE IF NOT EXISTS 'CHAT_MESSAGING';
ALTER TYPE "SupportCategory" ADD VALUE IF NOT EXISTS 'COMMUNITIES';
ALTER TYPE "SupportCategory" ADD VALUE IF NOT EXISTS 'POSTS_CONTENT';
ALTER TYPE "SupportCategory" ADD VALUE IF NOT EXISTS 'EVENTS_ACTIVITIES';
ALTER TYPE "SupportCategory" ADD VALUE IF NOT EXISTS 'NOTIFICATIONS';
ALTER TYPE "SupportCategory" ADD VALUE IF NOT EXISTS 'SAFETY_REPORTING';
ALTER TYPE "SupportCategory" ADD VALUE IF NOT EXISTS 'TECHNICAL';

CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "SupportAuthorType" AS ENUM ('USER', 'ADMIN', 'SYSTEM');
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');
CREATE TYPE "HelpContentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- -------------------------------------------------------- SupportTicket ----
ALTER TABLE "SupportTicket"
  ADD COLUMN "ticketNumber"    TEXT,
  ADD COLUMN "email"           TEXT,
  ADD COLUMN "name"            TEXT,
  ADD COLUMN "description"     VARCHAR(10000),
  ADD COLUMN "attachments"     JSONB,
  ADD COLUMN "assignedAdminId" TEXT,
  ADD COLUMN "browserInfo"     JSONB,
  ADD COLUMN "pageContext"     TEXT,
  ADD COLUMN "ipHash"          TEXT,
  ADD COLUMN "emailError"      TEXT,
  ADD COLUMN "closedAt"        TIMESTAMP(3);

ALTER TABLE "SupportTicket"
  ADD COLUMN "emailStatus" "EmailDeliveryStatus" NOT NULL DEFAULT 'PENDING';

-- Legacy rows predate the confirmation email; marking them PENDING would put a
-- permanent "not delivered" warning on tickets that never had one to send.
UPDATE "SupportTicket" SET "emailStatus" = 'SENT';

-- `priority` swaps enum: ReportPriority(LOW|MEDIUM|HIGH|CRITICAL) ->
-- SupportPriority(LOW|NORMAL|HIGH|URGENT). MEDIUM/CRITICAL have no same-named
-- counterpart, so the mapping is spelled out rather than cast.
ALTER TABLE "SupportTicket" ALTER COLUMN "priority" DROP DEFAULT;
ALTER TABLE "SupportTicket"
  ALTER COLUMN "priority" TYPE "SupportPriority"
  USING (
    CASE "priority"::text
      WHEN 'LOW'      THEN 'LOW'
      WHEN 'MEDIUM'   THEN 'NORMAL'
      WHEN 'HIGH'     THEN 'HIGH'
      WHEN 'CRITICAL' THEN 'URGENT'
      ELSE 'NORMAL'
    END
  )::"SupportPriority";
ALTER TABLE "SupportTicket" ALTER COLUMN "priority" SET DEFAULT 'NORMAL';

-- Backfill: reporter email from the account, description from the opening
-- message (the only place the old model stored the user's actual text).
UPDATE "SupportTicket" t
SET "email" = u."email",
    "name"  = COALESCE(u."displayName", u."username")
FROM "User" u
WHERE u."id" = t."userId" AND t."email" IS NULL;

UPDATE "SupportTicket" t
SET "description" = LEFT(COALESCE(m."body", t."subject"), 10000)
FROM (
  SELECT DISTINCT ON ("ticketId") "ticketId", "body"
  FROM "SupportMessage"
  WHERE "isInternal" = false
  ORDER BY "ticketId", "createdAt" ASC
) m
WHERE m."ticketId" = t."id" AND t."description" IS NULL;

UPDATE "SupportTicket"
SET "description" = LEFT("subject", 10000)
WHERE "description" IS NULL;

-- A ticket with no resolvable account email cannot be corresponded with; it is
-- kept (the thread is still readable) but flagged rather than dropped.
UPDATE "SupportTicket" SET "email" = '' WHERE "email" IS NULL;

-- Ticket numbers for legacy rows: MFT- plus 6 chars from Crockford-safe set.
UPDATE "SupportTicket"
SET "ticketNumber" = 'MFT-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', '') FROM 1 FOR 6))
WHERE "ticketNumber" IS NULL;

ALTER TABLE "SupportTicket"
  ALTER COLUMN "ticketNumber" SET NOT NULL,
  ALTER COLUMN "email"        SET NOT NULL,
  ALTER COLUMN "description"  SET NOT NULL,
  ALTER COLUMN "userId"       DROP NOT NULL,
  ALTER COLUMN "subject"      TYPE VARCHAR(200);

CREATE UNIQUE INDEX "SupportTicket_ticketNumber_key" ON "SupportTicket"("ticketNumber");

-- userId was CASCADE: deleting an account erased its support history, including
-- tickets about that very deletion. It is now detached instead.
ALTER TABLE "SupportTicket" DROP CONSTRAINT IF EXISTS "SupportTicket_userId_fkey";
ALTER TABLE "SupportTicket"
  ADD CONSTRAINT "SupportTicket_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupportTicket"
  ADD CONSTRAINT "SupportTicket_assignedAdminId_fkey"
  FOREIGN KEY ("assignedAdminId") REFERENCES "SuperAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SupportTicket_email_idx"           ON "SupportTicket"("email");
CREATE INDEX "SupportTicket_category_idx"        ON "SupportTicket"("category");
CREATE INDEX "SupportTicket_priority_idx"        ON "SupportTicket"("priority");
CREATE INDEX "SupportTicket_assignedAdminId_idx" ON "SupportTicket"("assignedAdminId");
CREATE INDEX "SupportTicket_status_createdAt_idx" ON "SupportTicket"("status", "createdAt");
DROP INDEX IF EXISTS "SupportTicket_status_idx";

-- ------------------------------------------------------- SupportMessage ----
ALTER TABLE "SupportMessage"
  ADD COLUMN "authorAdminId"  TEXT,
  ADD COLUMN "emailMessageId" TEXT,
  ADD COLUMN "emailError"     TEXT,
  ADD COLUMN "emailSentAt"    TIMESTAMP(3);

ALTER TABLE "SupportMessage"
  ADD COLUMN "authorType" "SupportAuthorType" NOT NULL DEFAULT 'USER',
  ADD COLUMN "emailStatus" "EmailDeliveryStatus";

-- The old model encoded "admin wrote this" as senderId IS NULL.
UPDATE "SupportMessage" SET "authorType" = 'ADMIN' WHERE "senderId" IS NULL;

ALTER TABLE "SupportMessage" ALTER COLUMN "body" TYPE VARCHAR(10000);

CREATE INDEX "SupportMessage_ticketId_createdAt_idx" ON "SupportMessage"("ticketId", "createdAt");
DROP INDEX IF EXISTS "SupportMessage_ticketId_idx";

-- ----------------------------------------------------------- help centre ---
CREATE TABLE "HelpCategory" (
  "id"          TEXT NOT NULL,
  "slug"        TEXT NOT NULL,
  "title"       VARCHAR(120) NOT NULL,
  "description" VARCHAR(500),
  "icon"        TEXT,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "status"      "HelpContentStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "archivedAt"  TIMESTAMP(3),
  CONSTRAINT "HelpCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HelpCategory_slug_key" ON "HelpCategory"("slug");
CREATE INDEX "HelpCategory_status_sortOrder_idx" ON "HelpCategory"("status", "sortOrder");

CREATE TABLE "HelpArticle" (
  "id"          TEXT NOT NULL,
  "slug"        TEXT NOT NULL,
  "categoryId"  TEXT NOT NULL,
  "question"    VARCHAR(300) NOT NULL,
  "summary"     VARCHAR(500),
  "body"        TEXT NOT NULL,
  "keywords"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "isFeatured"  BOOLEAN NOT NULL DEFAULT false,
  "status"      "HelpContentStatus" NOT NULL DEFAULT 'DRAFT',
  "viewCount"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "archivedAt"  TIMESTAMP(3),
  CONSTRAINT "HelpArticle_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HelpArticle_slug_key" ON "HelpArticle"("slug");
CREATE INDEX "HelpArticle_categoryId_sortOrder_idx" ON "HelpArticle"("categoryId", "sortOrder");
CREATE INDEX "HelpArticle_status_idx" ON "HelpArticle"("status");
CREATE INDEX "HelpArticle_status_isFeatured_idx" ON "HelpArticle"("status", "isFeatured");

ALTER TABLE "HelpArticle"
  ADD CONSTRAINT "HelpArticle_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "HelpCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Public help search is a trigram match over question/summary/keywords; without
-- these it degrades to a sequential scan on every keystroke.
CREATE INDEX "HelpArticle_question_trgm_idx" ON "HelpArticle" USING GIN ("question" gin_trgm_ops);
CREATE INDEX "HelpArticle_keywords_idx" ON "HelpArticle" USING GIN ("keywords");
