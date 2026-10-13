-- Per-pair interaction strength for the For You feed, written only by the
-- ranking worker (src/ranking/affinity.service.ts). Derived data: the table can
-- be emptied at any time and the next run rebuilds it. Additive, so the
-- previous release runs unchanged against it.
CREATE TABLE "UserAffinity" (
    "userId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAffinity_pkey" PRIMARY KEY ("userId","targetId")
);

CREATE INDEX "UserAffinity_updatedAt_idx" ON "UserAffinity"("updatedAt");
CREATE INDEX "UserAffinity_targetId_idx" ON "UserAffinity"("targetId");

ALTER TABLE "UserAffinity" ADD CONSTRAINT "UserAffinity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserAffinity" ADD CONSTRAINT "UserAffinity_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
