-- ErrorLog: append-only application error records for the admin Error Logs view.
--
-- Self-sufficient by design: this migration creates the table it needs and
-- references nothing else, so it applies cleanly against a database built from
-- an empty schema as well as against an existing one. No foreign keys - a row
-- must survive the deletion of the user it mentions, and a diagnostics table
-- should never be able to block a purge.
--
-- Backward-compatible with the previous release: it only adds, so rolling the
-- image back leaves the table present and unused rather than breaking a running
-- deployment.

-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" TEXT NOT NULL,
    "route" VARCHAR(300) NOT NULL,
    "path" VARCHAR(500) NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "severity" VARCHAR(20) NOT NULL,
    "message" VARCHAR(1000) NOT NULL,
    "name" VARCHAR(120),
    "stack" VARCHAR(4000),
    "requestId" VARCHAR(100),
    "userId" VARCHAR(64),
    "adminId" VARCHAR(64),
    "ip" VARCHAR(64),
    "userAgent" VARCHAR(300),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Drives the retention sweep and the default "last 7 days, newest first" view.
CREATE INDEX "ErrorLog_occurredAt_idx" ON "ErrorLog"("occurredAt");

-- CreateIndex
CREATE INDEX "ErrorLog_statusCode_occurredAt_idx" ON "ErrorLog"("statusCode", "occurredAt");

-- CreateIndex
-- Grouping repeats of the same fault, which is the first question asked of it.
CREATE INDEX "ErrorLog_route_occurredAt_idx" ON "ErrorLog"("route", "occurredAt");

-- CreateIndex
CREATE INDEX "ErrorLog_severity_occurredAt_idx" ON "ErrorLog"("severity", "occurredAt");
