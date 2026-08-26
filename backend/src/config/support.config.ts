import { email, invariant, str } from './env';
import { appConfigValues } from './app.config';
import { authConfigValues } from './auth.config';
import { siteConfigValues } from './site.config';

/**
 * Support-desk configuration.
 *
 * Nothing here is baked into the application code: which inbox is notified,
 * what address users reply to, and where the admin deep link points are all
 * environment values, so a new deployment is a variable change.
 */

/**
 * Reply-To on outgoing support mail.
 *
 * This is what makes "just reply to this email" true, so it should point at a
 * monitored inbox rather than at the no-reply sender the rest of the
 * transactional mail uses. Falls back to the published SUPPORT_EMAIL. When
 * neither is set the header is simply omitted.
 */
const replyTo = email('SUPPORT_REPLY_TO');

export const supportConfigValues = {
  replyTo: replyTo || undefined,

  /** Public help centre URL, referenced from the emails. */
  helpCentreUrl: `${appConfigValues.frontendUrl}/help-and-support`,

  /**
   * Salt for the one-way hash of a submitter's IP address.
   *
   * Defaults to an existing server secret so no new required variable is
   * introduced; set SUPPORT_IP_HASH_SALT to rotate it independently. An empty
   * salt would make the hashes a plain rainbow-table lookup of the IPv4 space,
   * so a deployment with neither value configured is caught at boot.
   */
  ipHashSalt:
    str('SUPPORT_IP_HASH_SALT') || authConfigValues.supabase.jwtSecret || authConfigValues.admin.accessSecret || '',
};


// A missing salt would reduce the stored hashes to a plain lookup of the IPv4
// space, which is not meaningfully different from storing the address itself.
invariant(
  supportConfigValues.ipHashSalt.length > 0,
  'Missing required environment variable: SUPPORT_IP_HASH_SALT (no SUPABASE_JWT_SECRET or ADMIN_JWT_ACCESS_SECRET to fall back on)',
);

export type SupportConfig = typeof supportConfigValues;
