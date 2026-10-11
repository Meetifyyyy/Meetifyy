/**
 * What the Help & Support hub offers, shared by the website page
 * (/help-and-support) and the app's Settings panel (/settings/help).
 *
 * Safety centre and Your requests are a `?view=` parameter on whichever route
 * hosts the hub rather than paths of their own: nested /help-and-support/*
 * URLs are redirected to the page at the edge (vercel.json), and a query
 * parameter keeps the Android back button popping one view at a time. Report a
 * problem and Share an idea are modals (SupportRequestModal), not views.
 */

export const HELP_VIEWS = {
  SAFETY: 'safety',
  REQUESTS: 'requests',
};

const KNOWN_VIEWS = new Set(Object.values(HELP_VIEWS));

/** The view named in a URLSearchParams, or null for the hub itself. */
export function viewFromParams(params) {
  const view = params.get('view');
  return KNOWN_VIEWS.has(view) ? view : null;
}

/** The emergency number shown at the top of the Safety centre. India-wide, 24/7. */
export const EMERGENCY_NUMBER = { number: '112', label: 'Emergency services' };

/**
 * National, free helplines. Shown only inside the Safety centre: the Help
 * hub links to it rather than listing numbers on every screen, which is how
 * the large social apps do it (Instagram, Snapchat, Discord all keep crisis
 * resources one tap away in a safety section, not on the help landing page).
 */
export const HELPLINES = [
  {
    number: '14416',
    name: 'Tele-MANAS',
    detail: 'Free, confidential mental health support, 24/7, in many Indian languages',
  },
  {
    number: '1930',
    name: 'Cyber Crime Helpline',
    detail: 'Online money fraud. Other cyber crime, such as harassment or misused photos, can be reported at cybercrime.gov.in',
  },
  {
    number: '181',
    name: "Women's Helpline",
    detail: 'Support for women facing harassment or violence, 24/7',
  },
];

/** Labels and tones for a ticket's status, as the user should read it. */
export const REQUEST_STATUS = {
  OPEN: { label: 'Received', tone: 'neutral' },
  IN_PROGRESS: { label: 'In progress', tone: 'active' },
  WAITING_FOR_USER: { label: 'Waiting for you', tone: 'attention' },
  RESOLVED: { label: 'Resolved', tone: 'done' },
  CLOSED: { label: 'Closed', tone: 'muted' },
};
