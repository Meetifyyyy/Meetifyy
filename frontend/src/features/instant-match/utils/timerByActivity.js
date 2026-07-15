import { ACCEPT_TIMERS } from '../constants/matchConstants';
import { classifyActivity } from './activityClassifier';

export function getAcceptTimer(activityId, timePreference) {
  if (timePreference === 'today') {
    return ACCEPT_TIMERS.today;
  }
  const category = classifyActivity(activityId);
  return ACCEPT_TIMERS[category] || ACCEPT_TIMERS.indoor;
}
