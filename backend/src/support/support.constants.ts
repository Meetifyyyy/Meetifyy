import { SupportCategory, SupportStatus, SupportPriority } from '@prisma/client';

/**
 * The categories the public form offers, in display order.
 *
 * This is deliberately narrower than the `SupportCategory` enum: the enum also
 * carries the legacy members (BUG, ACCOUNT, VERIFICATION, ABUSE,
 * FEATURE_REQUEST) that pre-date the help centre. Those still render correctly
 * in the admin queue but are not offered to new submissions.
 */
export const PUBLIC_SUPPORT_CATEGORIES: readonly SupportCategory[] = [
  SupportCategory.ACCOUNT_LOGIN,
  SupportCategory.PROFILE_PRIVACY,
  SupportCategory.CHAT_MESSAGING,
  SupportCategory.COMMUNITIES,
  SupportCategory.POSTS_CONTENT,
  SupportCategory.EVENTS_ACTIVITIES,
  SupportCategory.NOTIFICATIONS,
  SupportCategory.SAFETY_REPORTING,
  SupportCategory.TECHNICAL,
  SupportCategory.OTHER,
];

/** Human labels, shared by the admin UI, the public form and the emails. */
export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
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
  BUG: 'Bug Report',
  ACCOUNT: 'Account',
  VERIFICATION: 'Verification',
  ABUSE: 'Abuse',
  FEATURE_REQUEST: 'Feature Request',
};

/**
 * `OPEN` is what a freshly filed request is; it is presented as "New".
 * The stored name is left alone so tickets filed before the help centre keep
 * their status.
 */
export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {
  OPEN: 'New',
  IN_PROGRESS: 'In Progress',
  WAITING_FOR_USER: 'Waiting for User',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export const SUPPORT_PRIORITY_LABELS: Record<SupportPriority, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
};

/**
 * What the user is told about a status in an outgoing email. The admin picks
 * the status; this sentence is what the status *means* to someone outside the
 * queue, which is not the same as the internal label.
 */
export const SUPPORT_STATUS_USER_MESSAGE: Record<SupportStatus, string> = {
  OPEN: 'Your request is in our queue and a member of the team will pick it up shortly.',
  IN_PROGRESS: 'We are actively working on your request.',
  WAITING_FOR_USER: 'We need a little more information from you to proceed with your request.',
  RESOLVED: 'We consider this request resolved.',
  CLOSED: 'This request is now closed.',
};

/**
 * Safety reports are triaged above everything else by default. A user who
 * cannot get into their account is also time-critical in a way a question
 * about notification settings is not.
 */
export const DEFAULT_PRIORITY_BY_CATEGORY: Partial<Record<SupportCategory, SupportPriority>> = {
  SAFETY_REPORTING: SupportPriority.URGENT,
  ACCOUNT_LOGIN: SupportPriority.HIGH,
  ABUSE: SupportPriority.URGENT,
};

export const SUPPORT_ATTACHMENT_LIMITS = {
  maxFiles: 5,
  maxBytesPerFile: 10 * 1024 * 1024,
  /**
   * Screenshots and documents only. No video, no audio and no SVG - SVG is an
   * XML document that can carry script, and it would be served from the same
   * origin family as the app.
   */
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/plain'] as const,
};
