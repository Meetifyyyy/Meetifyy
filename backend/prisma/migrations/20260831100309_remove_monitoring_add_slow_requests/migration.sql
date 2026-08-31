-- Remove the application monitoring subsystem.
-- RequestLog / ErrorLog / SystemMetric / PerformanceBucket are dropped outright.
-- SlowRequest is rebuilt rather than altered: the replacement carries required
-- columns the old rows cannot supply, and its history is not worth migrating.

DROP TABLE IF EXISTS "ErrorLog";
DROP TABLE IF EXISTS "PerformanceBucket";
DROP TABLE IF EXISTS "RequestLog";
DROP TABLE IF EXISTS "SystemMetric";
DROP TABLE IF EXISTS "SlowRequest";

CREATE TABLE "SlowRequest" (
    "id"         TEXT NOT NULL,
    "route"      VARCHAR(300) NOT NULL,
    "path"       VARCHAR(500) NOT NULL,
    "method"     VARCHAR(10) NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "requestId"  VARCHAR(100),
    "userId"     VARCHAR(64),
    "adminId"    VARCHAR(64),
    "ip"         VARCHAR(64),
    "userAgent"  VARCHAR(300),
    "bytesOut"   INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlowRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SlowRequest_occurredAt_idx" ON "SlowRequest"("occurredAt");
CREATE INDEX "SlowRequest_durationMs_idx" ON "SlowRequest"("durationMs");
CREATE INDEX "SlowRequest_route_occurredAt_idx" ON "SlowRequest"("route", "occurredAt");
