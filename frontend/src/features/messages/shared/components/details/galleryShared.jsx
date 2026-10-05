import { useRef } from 'react';
import styles from './ChatDetailsPanel.module.css';
import { ChevronRight, Image as ImageIcon } from '@shared/components/icons';
import MediaThumb from '@shared/components/media/MediaThumb';
import { useElementSize } from '@shared/hooks/useElementSize';
import { useConversationMedia } from '../../hooks/useConversationMedia';
import { stripColumns } from '../../utils/galleryLayout';

/** "Open photo 3" - the tile's accessible name; nothing is invented about its content. */
export function galleryTileLabel(item, index) {
  return `Open ${item?.type === 'video' ? 'video' : 'photo'} ${index + 1}`;
}

/**
 * The one-row gallery preview in chat details.
 *
 * It asks the server for exactly as many items as fit in its row - measured, not
 * assumed - so a narrow phone requests three and a wide panel requests more, and
 * opening the details never fetches media that would not be drawn. Tapping the
 * header or a tile opens the full gallery, which pages through everything.
 *
 * Always one of: placeholders while the first answer is on the way, the tiles,
 * "No media" for a conversation that genuinely has none, or an error with a
 * retry. An empty answer is only ever reported once the server has given it.
 */
export function GalleryPreview({ conversationId, onOpen }) {
  const bodyRef = useRef(null);
  const { width } = useElementSize(bodyRef);
  const columns = stripColumns(width);
  const { items, isPending, isError, refetch } = useConversationMedia(conversationId, { pageSize: columns });

  const shown = items.slice(0, columns);
  const gridStyle = { '--gallery-strip-cols': columns || 3 };

  let body;
  if (isError && shown.length === 0) {
    body = (
      <div className={styles.noMediaContainer} role="alert">
        <span>Couldn&apos;t load media.</span>
        <button type="button" className={styles.galleryLoadOlder} onClick={() => refetch()}>
          Try again
        </button>
      </div>
    );
  } else if (isPending) {
    body = (
      <div className={styles.galleryRow} style={gridStyle} aria-hidden="true">
        {Array.from({ length: columns || 3 }, (_, i) => (
          <div key={i} className={`${styles.galleryThumbnail} ${styles.galleryThumbnailPlaceholder}`} />
        ))}
      </div>
    );
  } else if (shown.length === 0) {
    body = (
      <div className={styles.noMediaContainer}>
        <ImageIcon size={18} className={styles.noMediaIcon} />
        <span>No media</span>
      </div>
    );
  } else {
    body = (
      <div className={styles.galleryRow} style={gridStyle}>
        {shown.map((item, idx) => (
          <MediaThumb
            key={item.id}
            src={item.url}
            poster={item.thumbnailUrl}
            type={item.type}
            alt=""
            ariaLabel={galleryTileLabel(item, idx)}
            // One row, always on screen: no reason to wait for a scroll.
            lazy={false}
            onClick={onOpen}
            className={styles.galleryThumbnail}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={styles.galleryCard}>
      <button type="button" className={styles.galleryHeader} onClick={onOpen} aria-label="Open gallery">
        <span className={styles.galleryTitle}>Gallery</span>
        <ChevronRight className={styles.galleryChevron} size={20} aria-hidden="true" />
      </button>
      {/* Measured: the row's own width decides how many tiles to ask for. */}
      <div ref={bodyRef} className={styles.galleryBody}>
        {body}
      </div>
    </div>
  );
}
