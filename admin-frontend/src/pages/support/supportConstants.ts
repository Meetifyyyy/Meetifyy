/**
 * Labels and badge mappings for the Support section.
 *
 * These mirror the server's own constants (backend `support.constants.ts`).
 * They are labels only - the values the UI sends are the enum members, and the
 * server validates every one of them, so nothing here is load-bearing for
 * correctness. `OPEN` is presented as "New" for the same reason it is on the
 * public side: the stored name predates the help centre and renaming it would
 * have meant migrating every existing ticket.
 */

export const STATUS_LABELS: Record<string, string> = {
  OPEN: 'New',
  IN_PROGRESS: 'In Progress',
  WAITING_FOR_USER: 'Waiting for User',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export const STATUS_ORDER = ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'] as const;

export const STATUS_BADGE: Record<string, string> = {
  OPEN: 'badge-info',
  IN_PROGRESS: 'badge-warning',
  WAITING_FOR_USER: 'badge-neutral',
  RESOLVED: 'badge-success',
  CLOSED: 'badge-neutral',
};

export const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
};

export const PRIORITY_ORDER = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

export const PRIORITY_BADGE: Record<string, string> = {
  LOW: 'badge-neutral',
  NORMAL: 'badge-info',
  HIGH: 'badge-warning',
  URGENT: 'badge-danger',
};

export const CATEGORY_LABELS: Record<string, string> = {
  ACCOUNT_LOGIN: 'Account & Login',
  PROFILE_PRIVACY: 'Profile & Privacy',
  CHAT_MESSAGING: 'Chat & Messaging',
  COMMUNITIES: 'Communities',
  POSTS_CONTENT: 'Posts & Content',
  EVENTS_ACTIVITIES: 'Events & Activities',
  NOTIFICATIONS: 'Notifications',
  SAFETY_REPORTING: 'Safety & Reporting',
  TECHNICAL: 'Technical Issue',
  OTHER: 'Other',
  // Pre-help-centre categories. Still rendered because old tickets carry them.
  BUG: 'Bug Report',
  ACCOUNT: 'Account',
  VERIFICATION: 'Verification',
  ABUSE: 'Abuse',
  FEATURE_REQUEST: 'Feature Request',
};

/** Categories offered when filtering. Legacy members are appended, not hidden. */
export const FILTERABLE_CATEGORIES = Object.keys(CATEGORY_LABELS);

export const HELP_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
};

export const HELP_STATUS_BADGE: Record<string, string> = {
  DRAFT: 'badge-neutral',
  PUBLISHED: 'badge-success',
  ARCHIVED: 'badge-warning',
};

export const categoryLabel = (value: string) => CATEGORY_LABELS[value] ?? value;
export const statusLabel = (value: string) => STATUS_LABELS[value] ?? value;
export const priorityLabel = (value: string) => PRIORITY_LABELS[value] ?? value;

export function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "3 minutes ago" for the queue, where absolute times add noise. */
export function formatRelative(value?: string | null): string {
  if (!value) return '-';
  const then = new Date(value).getTime();
  const seconds = Math.round((Date.now() - then) / 1000);

  if (seconds < 60) return 'just now';
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86400],
    ['week', 604800],
    ['month', 2592000],
    ['year', 31536000],
  ];

  let chosen: [Intl.RelativeTimeFormatUnit, number] = units[0];
  for (const unit of units) {
    if (seconds >= unit[1]) chosen = unit;
  }

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  return formatter.format(-Math.floor(seconds / chosen[1]), chosen[0]);
}
