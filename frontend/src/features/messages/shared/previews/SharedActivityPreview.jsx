import { useNavigate } from 'react-router-dom';
import ActivityPreviewCard from './ActivityPreviewCard';
import { useCachedActivity } from '@shared/hooks/useCrew';
import { getMediaUrl } from '@shared/api/apiClient';
import { getDefaultActivityCover } from '@shared/utils/activityCover';

export function SharedActivityPreview({ activity: passedActivity, isMe = false }) {
  const navigate = useNavigate();
  // Enrichment from whatever the client already holds for this activity — no
  // request, and no subscription to the global data hook. This card renders once
  // per shared-activity message, so it previously pulled conversations, users,
  // campus users and communities into every chat bubble, then scanned the public
  // feed list to find one row.
  const cachedActivity = useCachedActivity(passedActivity?.id);
  const activity = { ...(cachedActivity || {}), ...passedActivity };

  if (!activity || (!activity.id && !activity.title)) return null;

  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (activity?.id) {
      navigate(`/crew/${activity.id}`, { state: { activity, from: 'chat' } });
    }
  };

  // getMediaUrl returns '' for anything that cannot be a media key, so the
  // fallback also covers a malformed cover value, not just a missing one.
  const rawCover = activity.image || activity.coverImage;
  const fallbackCover = getDefaultActivityCover(activity.id || activity.title || '');
  const coverSrc = (rawCover && getMediaUrl(rawCover)) || fallbackCover;

  return (
    <ActivityPreviewCard activity={activity} coverSrc={coverSrc} fallbackCover={fallbackCover} isMe={isMe} onClick={handleClick} />
  );
}
