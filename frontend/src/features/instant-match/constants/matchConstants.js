/**
 * Instant Match vocabulary.
 *
 * The `id` values are the wire contract and are mirrored by
 * `backend/src/instant-match/instant-match.constants.ts` — keep the two in
 * step. Everything else here (colour, emoji, copy) is presentation and is
 * safe to change on its own.
 */

export const STEP_ACTIVITY = 1;
export const STEP_TIME = 2;
export const STEP_DETAILS = 3;
export const STEP_LOCATION = 4;
export const STEP_SEARCHING = 5;

export const OPTIONAL_DETAIL_MAX = 60;

/**
 * Each activity carries its own ink + wash, so every card, chip and poster
 * panel in the flow is coloured by what the user is actually looking for.
 *
 * Both themes are declared here rather than derived: a saturated ink that
 * reads on cream paper is far too dark on near-black, and a pastel wash that
 * works in light mode turns to mud. The components hand both pairs to CSS,
 * which picks per theme — see `--im-tile-ink-l` / `--im-tile-ink-d`.
 */
export const MATCH_ACTIVITIES = [
  { id: 'study',   label: 'Study',   emoji: '📚', category: 'indoor',  ink: '#2563EB', wash: '#DBEAFE', inkDark: '#7FB0FF', washDark: '#1B2A44', verb: 'study' },
  { id: 'coding',  label: 'Coding',  emoji: '💻', category: 'indoor',  ink: '#0F766E', wash: '#CCFBF1', inkDark: '#5FD5C4', washDark: '#10322F', verb: 'code' },
  { id: 'sports',  label: 'Sports',  emoji: '🏸', category: 'outdoor', ink: '#C2410C', wash: '#FFEDD5', inkDark: '#FF9A63', washDark: '#3B2113', verb: 'play sports' },
  { id: 'coffee',  label: 'Coffee',  emoji: '☕', category: 'indoor',  ink: '#92400E', wash: '#FEF3C7', inkDark: '#E0A96D', washDark: '#33240F', verb: 'grab coffee' },
  { id: 'food',    label: 'Food',    emoji: '🍜', category: 'indoor',  ink: '#BE123C', wash: '#FFE4E6', inkDark: '#FF8FA8', washDark: '#3A1620', verb: 'grab food' },
  { id: 'gaming',  label: 'Gaming',  emoji: '🎮', category: 'indoor',  ink: '#7C3AED', wash: '#EDE9FE', inkDark: '#B79BFF', washDark: '#29204A', verb: 'play games' },
  { id: 'walk',    label: 'Walk',    emoji: '🚶', category: 'outdoor', ink: '#15803D', wash: '#DCFCE7', inkDark: '#6BD68F', washDark: '#14301F', verb: 'go for a walk' },
  { id: 'movie',   label: 'Movie',   emoji: '🎬', category: 'indoor',  ink: '#4338CA', wash: '#E0E7FF', inkDark: '#9AA3FF', washDark: '#22254D', verb: 'watch a movie' },
  { id: 'event',   label: 'Event',   emoji: '🎉', category: 'indoor',  ink: '#A21CAF', wash: '#FAE8FF', inkDark: '#EC8FF5', washDark: '#3A1741', verb: 'hit an event' },
  { id: 'chat',    label: 'Chat',    emoji: '💬', category: 'indoor',  ink: '#0369A1', wash: '#E0F2FE', inkDark: '#6BC2F0', washDark: '#102C3D', verb: 'just talk' },
  { id: 'library', label: 'Library', emoji: '📖', category: 'indoor',  ink: '#7C2D12', wash: '#FEF0E7', inkDark: '#D99A72', washDark: '#33200F', verb: 'hit the library' },
  { id: 'other',   label: 'Other',   emoji: '✨', category: 'indoor',  ink: '#475569', wash: '#E2E8F0', inkDark: '#A9B6C6', washDark: '#262C35', verb: 'meet up' },
];

/**
 * The inline custom properties every themed Instant Match surface expects.
 * Returns undefined for an unknown id so the caller falls back to the
 * feature's default violet rather than rendering with half a palette.
 */
export function accentVars(activityOrTime, prefix = 'im-tile') {
  if (!activityOrTime) return undefined;
  return {
    [`--${prefix}-ink-l`]: activityOrTime.ink,
    [`--${prefix}-ink-d`]: activityOrTime.inkDark,
    [`--${prefix}-wash-l`]: activityOrTime.wash,
    [`--${prefix}-wash-d`]: activityOrTime.washDark,
  };
}

const ACTIVITY_BY_ID = new Map(MATCH_ACTIVITIES.map((a) => [a.id, a]));

export function getActivity(id) {
  return ACTIVITY_BY_ID.get(id) || null;
}

/** Human label for an activity id, safe for any value the server sends. */
export function getActivityLabel(id, fallback = 'something') {
  return ACTIVITY_BY_ID.get(id)?.label ?? fallback;
}

export function getActivityVerb(id) {
  return ACTIVITY_BY_ID.get(id)?.verb ?? 'meet up';
}

export const TIME_PREFERENCES = [
  {
    id: 'now',
    title: 'Right now',
    desc: 'Someone free this minute',
    emoji: '⚡',
    ink: '#C2410C', wash: '#FFEDD5',
    inkDark: '#FF9A63', washDark: '#3B2113',
  },
  {
    id: '30min',
    title: 'In 30 minutes',
    desc: 'Heading out shortly',
    emoji: '⏱',
    ink: '#2563EB', wash: '#DBEAFE',
    inkDark: '#7FB0FF', washDark: '#1B2A44',
  },
  {
    id: 'today',
    title: 'Later today',
    desc: 'Anytime before tonight',
    emoji: '🌤',
    ink: '#7C3AED', wash: '#EDE9FE',
    inkDark: '#B79BFF', washDark: '#29204A',
  },
];

export function getTimePreference(id) {
  return TIME_PREFERENCES.find((t) => t.id === id) || null;
}

export const CAMPUS_AREAS = [
  { id: 'library',        label: 'Library',        emoji: '📖' },
  { id: 'cafeteria',      label: 'Cafeteria',      emoji: '🍽' },
  { id: 'hostel',         label: 'Hostel',         emoji: '🏠' },
  { id: 'academic_block', label: 'Academic Block', emoji: '🏛' },
  { id: 'sports_complex', label: 'Sports Complex', emoji: '🏟' },
  { id: 'main_gate',      label: 'Main Gate',      emoji: '🚪' },
  { id: 'other',          label: 'Somewhere else', emoji: '📍' },
];

export function getAreaLabel(id) {
  return CAMPUS_AREAS.find((a) => a.id === id)?.label ?? null;
}

export const ACTIVITY_DETAILS_CONFIG = {
  study:   { label: 'Which subject?',      placeholder: 'Physics, Calculus…' },
  sports:  { label: 'Which sport?',        placeholder: 'Badminton, Football…' },
  coding:  { label: 'Stack or project?',   placeholder: 'React, Python, hackathon…' },
  food:    { label: 'Which spot?',         placeholder: 'Central Food Court…' },
  coffee:  { label: 'Which cafe?',         placeholder: 'The one near the gate…' },
  library: { label: 'Which floor?',        placeholder: 'Central Library, 2nd floor…' },
};

/** Accept-window in seconds. Mirrors the backend; the server's absolute
 *  deadline always wins, this is only the fallback for the ring. */
export const ACCEPT_TIMERS = { indoor: 30, outdoor: 60, today: 90 };
