import type { Job } from 'bullmq';

/**
 * The data an `email` queue job carries: the contract between EmailService,
 * which enqueues, and EmailProcessor, which renders and sends.
 *
 * One shape for every job name, because BullMQ does not tie a job's data to
 * its name. Template jobs set `email` and the fields their template reads;
 * support jobs set only the row id the worker renders from.
 */
export interface EmailJobData {
  /** Recipient. Set by every template job; support jobs resolve their own. */
  email?: string;
  name?: string;
  /** Overrides the default sender (the security sender for OTP mail). */
  from?: string;
  device?: string;
  location?: string;
  time?: string;
  browser?: string;
  os?: string;
  ip?: string;
  resetLink?: string;
  otp?: string;
  scheduledDeletionDate?: string;
  /** Support jobs: the ticket or reply the worker loads and renders. */
  ticketId?: string;
  messageId?: string;
}

export type EmailJob = Job<EmailJobData, unknown, string>;
