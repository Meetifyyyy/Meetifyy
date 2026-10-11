-- Problem reports and ideas share the support queue; this tells them apart.
-- Additive with a default, so the previous release (which never sends a type)
-- keeps working and every existing ticket reads as a PROBLEM.
CREATE TYPE "SupportRequestType" AS ENUM ('PROBLEM', 'IDEA');

ALTER TABLE "SupportTicket"
  ADD COLUMN "type" "SupportRequestType" NOT NULL DEFAULT 'PROBLEM';

CREATE INDEX "SupportTicket_type_createdAt_idx" ON "SupportTicket"("type", "createdAt");
