import { getActivity } from '../constants/matchConstants';

export function classifyActivity(activityId) {
  return getActivity(activityId)?.category ?? 'indoor';
}
