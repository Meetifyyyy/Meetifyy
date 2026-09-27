import { memo, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMediaUrl, deriveThumbnailKey } from '@shared/api/apiClient';
import { mediaCache } from '@shared/utils/MediaCacheManager';
import { formatCardDateBadge } from '../utils/formatEvent';
import CampusEventCardView from './CampusEventCardView';

/**
 * Poster source for a card, cheapest acceptable variant first.
 *
 * The card paints the poster at ~215-245 CSS px; the stored original is a
 * full-resolution portrait upload. `/api/media/<key>_thumb.webp` answers with
 * the smaller variant when the upload produced one and redirects to the
 * original when it did not, so asking for the thumbnail is never worse than
 * asking for the original — which is what this used to do on every card, since
 * `mediaCache.getSyncUrl` only ever has a URL for media some other screen has
 * already resolved.
 */
function posterSources(posterUrl) {
  if (!posterUrl) return { primary: '', full: '', thumbKey: null };
  const thumbKey = deriveThumbnailKey(posterUrl);
  const full = getMediaUrl(posterUrl);
  if (!thumbKey) return { primary: full, full, thumbKey: null };
  return {
    primary: mediaCache.getSyncUrl(thumbKey) || getMediaUrl(thumbKey),
    full,
    thumbKey,
  };
}

/**
 * Modern High-Contrast Campus Event Card.
 * Redesigned to reflect the bold, modern card visual hierarchy of the reference:
 * inset rounded poster with bottom date pill, bold title typography,
 * and host/organizer row with avatar/initial.
 */
function CampusEventCard({ event, canManage = false, onEdit, onDelete, priority = false }) {
  const navigate = useNavigate();
  // Keyed by the poster it gave up on, so editing an event's picture gets a
  // fresh attempt instead of inheriting the previous one's failure.
  const [failedPoster, setFailedPoster] = useState(null);

  const posterUrl = event?.posterUrl;
  const { primary, full, thumbKey } = useMemo(() => posterSources(posterUrl), [posterUrl]);
  const formattedDate = useMemo(() => formatCardDateBadge(event?.startTime), [event?.startTime]);

  const eventId = event?.id;
  const openDetail = useCallback(() => {
    if (eventId) navigate(`/campus/events/${eventId}`);
  }, [navigate, eventId]);

  const handlePosterError = useCallback((e) => {
    // The thumbnail is the optimistic guess; the original is the answer we can
    // rely on. Falling back once, then giving up, keeps a genuinely missing
    // poster from looping requests.
    if (thumbKey) mediaCache.invalidate(thumbKey);
    if (full && e.currentTarget.src !== full) {
      e.currentTarget.src = full;
    } else {
      setFailedPoster(posterUrl);
    }
  }, [thumbKey, full, posterUrl]);

  const handleEdit = useCallback((e) => { e.stopPropagation(); onEdit?.(event); }, [onEdit, event]);
  const handleDelete = useCallback((e) => { e.stopPropagation(); onDelete?.(event); }, [onDelete, event]);

  if (!event) return null;

  return <CampusEventCardView event={event} posterSrc={primary} formattedDate={formattedDate}
    canManage={canManage} priority={priority} posterHidden={failedPoster === posterUrl}
    onOpen={openDetail} onPosterError={handlePosterError} onEdit={handleEdit} onDelete={handleDelete} />;
}

/**
 * Memoized: the Campus page re-renders on every menu toggle, modal open and
 * background refetch, and each of those re-rendered every card in the grid.
 * Callers must pass stable `onEdit` / `onDelete`.
 */
export default memo(CampusEventCard);
