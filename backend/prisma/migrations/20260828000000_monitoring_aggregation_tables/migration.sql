-- PerformanceBucket: 5-minute pre-aggregated performance records.
-- Replaces raw RequestLog GROUP BY queries for the 7-day chart.
-- At most 7d × 24h × 12 buckets = 2,016 rows for the rolling window.

CREATE TABLE "PerformanceBucket" (
    "id"            TEXT NOT NULL,
    "bucketAt"      TIMESTAMP(3) NOT NULL,
    "totalRequests" INTEGER NOT NULL,
    "errorCount"    INTEGER NOT NULL,
    "avgLatencyMs"  DOUBLE PRECISION NOT NULL,
    "maxLatencyMs"  INTEGER NOT NULL,
    "p95LatencyMs"  DOUBLE PRECISION NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceBucket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PerformanceBucket_bucketAt_key" ON "PerformanceBucket"("bucketAt");
CREATE INDEX "PerformanceBucket_bucketAt_idx" ON "PerformanceBucket"("bucketAt");

-- SlowRequest: materialised slow-request log for the rolling 7-day view.
-- Populated by MetricsAggregatorService. Pruned on the same schedule.

CREATE TABLE "SlowRequest" (
    "id"         TEXT NOT NULL,
    "route"      VARCHAR(300) NOT NULL,
    "method"     VARCHAR(10) NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "requestId"  TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlowRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SlowRequest_occurredAt_idx" ON "SlowRequest"("occurredAt");
CREATE INDEX "SlowRequest_durationMs_idx" ON "SlowRequest"("durationMs");
CREATE INDEX "SlowRequest_route_durationMs_idx" ON "SlowRequest"("route", "durationMs");
