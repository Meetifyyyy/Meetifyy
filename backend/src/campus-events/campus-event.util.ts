import { BadRequestException } from '@nestjs/common';
import { config } from '../config';

/**
 * Validates and normalizes an external registration URL.
 *
 * Rules (enforced server-side — the frontend check is convenience only):
 *   - Must parse as a URL.
 *   - Only http/https schemes; `javascript:`, `data:`, etc. are rejected.
 *   - https is required, EXCEPT http is allowed for localhost in non-production
 *     (so local dev / test forms work).
 *
 * Returns the normalized URL string, or `null` when the input is empty.
 */
export function sanitizeRegistrationUrl(raw?: string | null): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  if (trimmed.length > 2048) {
    throw new BadRequestException('Registration URL is too long.');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new BadRequestException('Registration URL must be a valid absolute URL.');
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'https:' && protocol !== 'http:') {
    throw new BadRequestException('Registration URL must use http or https.');
  }

  const isProd = config.isProduction;
  const host = parsed.hostname.toLowerCase();
  const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');

  if (protocol === 'http:' && !(isLocalhost && !isProd)) {
    throw new BadRequestException('Registration URL must use https.');
  }

  return parsed.toString();
}

/** Coherence check for event times. Throws on invalid/incoherent input. */
export function assertCoherentEventTimes(startTime: Date, endTime: Date): void {
  if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
    throw new BadRequestException('Invalid start or end time.');
  }
  const now = new Date();
  // Allow a 5-minute grace period for clock drift and request latency
  if (startTime.getTime() < now.getTime() - 5 * 60 * 1000) {
    throw new BadRequestException('Event start date/time cannot be in the past.');
  }
  if (endTime.getTime() <= startTime.getTime()) {
    throw new BadRequestException('End time must be after start time.');
  }
  const maxDurationMs = 30 * 24 * 60 * 60 * 1000; // 30 days
  if (endTime.getTime() - startTime.getTime() > maxDurationMs) {
    throw new BadRequestException('Event duration cannot exceed 30 days.');
  }
}
