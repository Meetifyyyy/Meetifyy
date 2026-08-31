-- Suspension appeals are support tickets in their own category, so the admin
-- queue can present them as a separate section without a parallel inbox.
ALTER TYPE "SupportCategory" ADD VALUE IF NOT EXISTS 'SUSPENSION_APPEAL';
