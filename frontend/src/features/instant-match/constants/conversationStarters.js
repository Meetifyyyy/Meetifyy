/**
 * Optional openers for a chat that has barely started.
 *
 * Instant Match pairs strangers, and a blank thread between strangers usually
 * stays blank. These are prompts, never gates: they sit above the composer,
 * they can be dismissed, and typing anything at all replaces them.
 *
 * Keyed by activity where a tailored prompt reads better than a generic one,
 * with a shared fallback set.
 */
const GENERAL = [
  'What made you pick this?',
  'What are you into at the moment?',
  'What is one thing you both might enjoy?',
  'Anything you want to try this week?',
  'What should we actually do?',
];

const BY_ACTIVITY = {
  study: [
    'What are you working on?',
    'Which spot do you study best in?',
    'Exam soon, or just keeping up?',
  ],
  coding: [
    'What are you building?',
    'Which stack are you on?',
    'Stuck on something, or starting fresh?',
  ],
  coffee: [
    'Where does the good coffee live on campus?',
    'How do you take it?',
    'Free in the next hour?',
  ],
  food: [
    'What are you craving?',
    'Best cheap meal near campus?',
    'Canteen or somewhere out?',
  ],
  sports: [
    'How long have you been playing?',
    'Which court do you usually get?',
    'Casual or competitive?',
  ],
  gaming: [
    'What are you playing right now?',
    'Co-op or head to head?',
    'What is the last game that got you properly hooked?',
  ],
  walk: [
    'Where do you usually walk?',
    'Long loop or a quick one?',
    'Free now, or later?',
  ],
  movie: [
    'What is the last thing you watched?',
    'Which genre are you in the mood for?',
    'Cinema or a screen somewhere?',
  ],
  library: [
    'Which floor do you swear by?',
    'Silent section or the group tables?',
    'How long are you in for?',
  ],
  chat: [
    'What is on your mind today?',
    'What has your week been like?',
    'Tell me something you are excited about.',
  ],
};

/** Up to `count` prompts for an activity, generic ones filling the rest. */
export function getConversationStarters(activity, count = 3) {
  const tailored = BY_ACTIVITY[activity] || [];
  return [...tailored, ...GENERAL].slice(0, count);
}

/**
 * Starters stop being helpful the moment a conversation exists. Shown only
 * while the thread is essentially empty — the opening system line does not
 * count as anyone having spoken.
 */
export const STARTERS_MESSAGE_THRESHOLD = 3;
