import { useCallback, useEffect, useRef, useState } from 'react';
import sharedStyles from './ChatDetailsPanel.module.css';
import styles from './ChatGalleryPage.module.css';
import { Image as ImageIcon, ArrowLeft } from '@shared/components/icons';
import { useMediaViewerActions } from '@shared/context/MediaViewerContext';
import { useElementSize } from '@shared/hooks/useElementSize';
import MediaThumb from '@shared/components/media/MediaThumb';
import { chatMediaItem } from '../../utils/chatMediaItem';
import { gridColumns, gridPageSize } from '../../utils/galleryLayout';
import { useConversationMedia } from '../../hooks/useConversationMedia';
import { galleryTileLabel } from './galleryShared';

/**
 * The viewer item for one gallery entry.
 *
 * Built by the same helper the conversation uses, so an attachment opened from
 * the gallery carries what it would carry opened from its message: the poster
 * (`thumb`), the message id, and the report target - the MESSAGE, never the URL.
 * Own attachments simply have no `report`.
 */
export function galleryViewerItem(m) {
  const type = m.type || (/\.(mp4|mov|mkv|webm)/i.test(m.url || '') ? 'video' : 'image');
  return chatMediaItem(m.url, type, { thumb: m.thumbnailUrl, id: m.id, report: m.report });
}

/**
 * Every shared photo and video of the conversation, newest first.
 *
 * Paged from the server as the person scrolls: the first page is sized from the
 * screen it is on (see galleryLayout), the next one is requested when the end of
 * the grid comes within a screen of view, and nothing more is requested once the
 * server says there is no more. The size is fixed after the first measurement,
 * so rotating the phone re-flows the tiles without re-fetching the gallery.
 */
export default function ChatGalleryPage({ conversationId, onBack }) {
  const { openViewer } = useMediaViewerActions();

  const bodyRef = useRef(null);
  const sentinelRef = useRef(null);
  const { width, height } = useElementSize(bodyRef);

  const [pageSize, setPageSize] = useState(0);
  useEffect(() => {
    if (pageSize === 0) setPageSize(gridPageSize(width, height));
  }, [pageSize, width, height]);

  const { items, isPending, isError, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } =
    useConversationMedia(conversationId, { pageSize });

  // Load on approach. The observer is rebuilt after every page so that it reports
  // the sentinel's CURRENT position: a tall screen that one page does not fill
  // keeps the sentinel in view, and an observer created once would never fire again.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = bodyRef.current;
    if (!sentinel || !root || !hasNextPage || isFetchingNextPage || isError) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      fetchNextPage();
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) fetchNextPage();
      },
      { root, rootMargin: '0px 0px 100% 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, isError, items.length, fetchNextPage]);

  const openAt = useCallback((index) => {
    openViewer(items.map(galleryViewerItem), index);
  }, [items, openViewer]);

  const columns = gridColumns(width) || 3;
  const gridStyle = { '--gallery-cols': columns };

  let content;
  if (isError && items.length === 0) {
    content = (
      <div className={styles.galleryState} role="alert">
        <span>Couldn&apos;t load media.</span>
        <button type="button" className={sharedStyles.galleryLoadOlder} onClick={() => refetch()}>
          Try again
        </button>
      </div>
    );
  } else if (isPending) {
    content = (
      <div className={styles.galleryGrid} style={gridStyle} aria-hidden="true">
        {Array.from({ length: columns * 3 }, (_, i) => (
          <div key={i} className={`${styles.galleryGridItem} ${styles.galleryPlaceholder}`} />
        ))}
      </div>
    );
  } else if (items.length === 0) {
    content = (
      <div className={styles.galleryState}>
        <ImageIcon size={36} className={sharedStyles.noMediaIcon} />
        <span>No media</span>
      </div>
    );
  } else {
    content = (
      <div className={styles.galleryGrid} style={gridStyle}>
        {items.map((item, idx) => (
          <MediaThumb
            key={item.id}
            src={item.url}
            poster={item.thumbnailUrl}
            type={item.type}
            alt=""
            ariaLabel={galleryTileLabel(item, idx)}
            onClick={() => openAt(idx)}
            className={styles.galleryGridItem}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={sharedStyles.container}>
      <div className={sharedStyles.header}>
        <button
          type="button"
          className={sharedStyles.backBtn}
          onClick={onBack}
          title="Back"
          aria-label="Back"
        >
          <ArrowLeft size={20} />
        </button>
        <h2 className={sharedStyles.headerTitle}>Gallery</h2>
        <div style={{ width: '40px' }} />
      </div>

      <div ref={bodyRef} className={styles.galleryBody}>
        {content}
        {isError && items.length > 0 && (
          <div className={styles.galleryFooter} role="alert">
            <span>Couldn&apos;t load more.</span>
            <button type="button" className={sharedStyles.galleryLoadOlder} onClick={() => fetchNextPage()}>
              Try again
            </button>
          </div>
        )}
        {isFetchingNextPage && <div className={styles.galleryFooter} role="status">Loading&hellip;</div>}
        <div ref={sentinelRef} className={styles.gallerySentinel} aria-hidden="true" />
      </div>
    </div>
  );
}
