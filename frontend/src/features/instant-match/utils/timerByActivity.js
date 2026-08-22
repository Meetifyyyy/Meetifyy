import { ACCEPT_TIMERS } from '../constants/matchConstants';
import { classifyActivity } from './activityClassifier';

/** Fallback accept window. The server sends an absolute `expiresAt` with every
 *  match, so this is only used when that is somehow missing. */
export function getAcceptTimer(activityId, timePreference) {
  if (timePreference === 'today') return ACCEPT_TIMERS.today;
  return ACCEPT_TIMERS[classifyActivity(activityId)] ?? ACCEPT_TIMERS.indoor;
}
