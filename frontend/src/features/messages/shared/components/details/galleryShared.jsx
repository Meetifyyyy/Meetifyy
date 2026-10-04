import styles from './ChatDetailsPanel.module.css';
import { ChevronRight, Image as ImageIcon } from '@shared/components/icons';
import MediaThumb from '@shared/components/media/MediaThumb';
import { checkIsMe } from '../../utils/cacheUtils';

/** How many tiles the details preview shows. The full set is one tap away. */
export const GALLERY_STRIP_LIMIT = 12;

/** "Open photo 3 of 12" — the tile's accessible name; nothing is invented about its content. */
export function galleryTileLabel(item, index, total) {
  return `Open ${item?.type === 'video' ? 'video' : 'photo'} ${index + 1} of ${total}`;
}

/**
 * The note shown while the gallery is built from the messages loaded so far.
 *
 * There is no media-history endpoint yet, so the gallery is a projection of the
 * conversation's loaded pages. Saying so beats presenting a partial list as the
 * complete one. `hasMore === false` is the only state in which it is complete;
 * when the panel is not told (undefined) it cannot know, so it still says so.
 */
export function GalleryCoverageNote({ hasMore, isLoadingMore, onLoadMore }) {
  if (hasMore === false) return null;
  return (
    <div className={styles.galleryCoverage}>
      <span>Shows media from the messages loaded so far.</span>
      {hasMore && typeof onLoadMore === 'function' && (
        <button
          type="button"
          className={styles.galleryLoadOlder}
          onClick={onLoadMore}
          disabled={isLoadingMore}
        >
          {isLoadingMore ? 'Loading\u2026' : 'Load older messages'}
        </button>
      )}
    </div>
  );
}

/**
 * The horizontal gallery preview shown in chat details.
 *
 * Defined once. It was previously inlined twice — identically — in the DM and
 * group branches of the panel, so the raw-URL bug below had to be fixed in two
 * places and any future change would need remembering in both.
 *
 * Capped at GALLERY_STRIP_LIMIT tiles: it used to mount every item, and each one
 * asks the API to sign its URL, so a long history made one oversized request.
 */
export function GalleryStrip({ mediaList, onOpen, coverage }) {
  const hasMedia = Array.isArray(mediaList) && mediaList.length > 0;
  const total = hasMedia ? mediaList.length : 0;
  const shown = hasMedia ? mediaList.slice(0, GALLERY_STRIP_LIMIT) : [];
  return (
    <div className={styles.galleryCard}>
      <button
        type="button"
        className={styles.galleryHeader}
        onClick={onOpen}
        aria-label={total > 0 ? `Open gallery, ${total} ${total === 1 ? 'item' : 'items'}` : 'Open gallery'}
      >
        <span className={styles.galleryTitle}>Gallery</span>
        <ChevronRight className={styles.galleryChevron} size={20} aria-hidden="true" />
      </button>
      {hasMedia ? (
        <div className={styles.galleryRow}>
          {shown.map((item, idx) => (
            <MediaThumb
              key={`${item.url}-${idx}`}
              src={item.url}
              poster={item.thumbnailUrl}
              type={item.type}
              alt=""
              ariaLabel={galleryTileLabel(item, idx, total)}
              // A dozen at most, always on screen: no reason to wait for a scroll.
              lazy={false}
              onClick={onOpen}
              className={styles.galleryThumbnail}
            />
          ))}
        </div>
      ) : (
        <div className={styles.noMediaContainer}>
          <ImageIcon size={18} className={styles.noMediaIcon} />
          <span>No media</span>
        </div>
      )}
      {coverage}
    </div>
  );
}


/**
 * What the viewer needs to know about the message an attachment came from.
 *
 * The report target is the MESSAGE, never the URL. Only a server-confirmed
 * message that someone else sent can be reported: an optimistic (`temp_`) one has
 * no server id yet, and there is no reporting your own. Returns `{}` for those —
 * and for entries that are not attachments of a real message at all.
 */
export function galleryOrigin(msg, currentUser) {
  const id = msg && msg.id != null ? String(msg.id) : '';
  const confirmed = Boolean(id) && !id.startsWith('temp_') && !id.startsWith('c_temp_') && !msg.isOptimistic;
  if (!confirmed) return {};
  return {
    id,
    report: checkIsMe(msg, currentUser) ? undefined : { targetType: 'MESSAGE', targetId: id },
  };
}
