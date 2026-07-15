import { MATCH_ACTIVITIES } from '../constants/matchConstants';

export function classifyActivity(activityId) {
  const found = MATCH_ACTIVITIES.find(a => a.id === activityId);
  return found ? found.category : 'indoor';
}
