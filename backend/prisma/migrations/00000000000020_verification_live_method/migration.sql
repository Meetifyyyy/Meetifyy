-- Verification by ONE live camera capture: a selfie or a photo of a
-- government ID, chosen by the user.
--
-- Backward-compatible with the previous release: it only ever inserts rows
-- with both documents and no method, which the CHECK below accepts, and it
-- reads `selfieMediaId` / `idCardMediaId` through relations that already
-- tolerate null in the admin review. A rollback of the image is safe.

CREATE TYPE "VerificationMethod" AS ENUM ('LIVE_SELFIE', 'LIVE_GOVERNMENT_ID');

ALTER TABLE "VerificationRequest" ADD COLUMN "method" "VerificationMethod",
ALTER COLUMN "selfieMediaId" DROP NOT NULL,
ALTER COLUMN "idCardMediaId" DROP NOT NULL;

-- The method and the documents must agree, enforced by the database rather
-- than only the service: a live-selfie attempt carries exactly the selfie, a
-- government-ID attempt exactly the ID, and a legacy attempt (null method)
-- both. A request with no document at all is impossible.
--
-- Every branch is written to be TRUE or FALSE, never NULL: a CHECK passes on
-- NULL, and with "method" null a bare `"method" = 'LIVE_SELFIE'` is NULL, which
-- let a legacy row with only one document through. COALESCE pins it to false.
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_method_documents_check" CHECK (
  ("method" IS NULL AND "selfieMediaId" IS NOT NULL AND "idCardMediaId" IS NOT NULL)
  OR (COALESCE("method" = 'LIVE_SELFIE', false) AND "selfieMediaId" IS NOT NULL AND "idCardMediaId" IS NULL)
  OR (COALESCE("method" = 'LIVE_GOVERNMENT_ID', false) AND "idCardMediaId" IS NOT NULL AND "selfieMediaId" IS NULL)
);
