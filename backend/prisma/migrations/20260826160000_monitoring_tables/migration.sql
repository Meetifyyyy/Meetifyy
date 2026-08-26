-- Application-level monitoring tables.
--
-- These hold what the hosting provider's own logs cannot show: per-endpoint
-- latency, error rates and resource snapshots over time. Plain Postgres with
-- no extensions, so nothing here ties the project to a particular host.

CREATE TABLE "RequestLog" (
  "id"           TEXT NOT NULL,
  "requestId"    TEXT,
  "method"       VARCHAR(10) NOT NULL,
  "route"        VARCHAR(300) NOT NULL,
  "statusCode"   INTEGER NOT NULL,
  "durationMs"   INTEGER NOT NULL,
  "responseSize" INTEGER,
  "userId"       TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RequestLog_pkey" PRIMARY KEY ("id")
);

-- The dashboard reads "recent rows, newest first", optionally narrowed to a
-- route or a status class. Each index serves a filter and its sort together.
CREATE INDEX "RequestLog_createdAt_idx" ON "RequestLog"("createdAt");
CREATE INDEX "RequestLog_route_createdAt_idx" ON "RequestLog"("route", "createdAt");
CREATE INDEX "RequestLog_statusCode_createdAt_idx" ON "RequestLog"("statusCode", "createdAt");

CREATE TABLE "ErrorLog" (
  "id"         TEXT NOT NULL,
  "requestId"  TEXT,
  "route"      VARCHAR(300) NOT NULL,
  "statusCode" INTEGER,
  "message"    VARCHAR(2000) NOT NULL,
  "stack"      TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ErrorLog_createdAt_idx" ON "ErrorLog"("createdAt");
CREATE INDEX "ErrorLog_route_createdAt_idx" ON "ErrorLog"("route", "createdAt");

CREATE TABLE "SystemMetric" (
  "id"                TEXT NOT NULL,
  "memoryRssMb"       DOUBLE PRECISION NOT NULL,
  "memoryHeapUsedMb"  DOUBLE PRECISION NOT NULL,
  "cpuPercent"        DOUBLE PRECISION NOT NULL,
  "eventLoopLagMs"    DOUBLE PRECISION NOT NULL,
  "dbPoolActive"      INTEGER NOT NULL,
  "dbPoolIdle"        INTEGER NOT NULL,
  "dbPoolWaiting"     INTEGER NOT NULL,
  "socketConnections" INTEGER NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SystemMetric_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SystemMetric_createdAt_idx" ON "SystemMetric"("createdAt");
