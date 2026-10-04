import { useCallback } from 'react';
import sharedStyles from './ChatDetailsPanel.module.css';
import styles from './ChatGalleryPage.module.css';
import { Image as ImageIcon, ArrowLeft } from '@shared/components/icons';
import { useMediaViewerActions } from '@shared/context/MediaViewerContext';
import MediaThumb from '@shared/components/media/MediaThumb';
import { chatMediaItem } from '../../utils/chatMediaItem';
import { GalleryCoverageNote, galleryTileLabel } from './galleryShared';

/**
 * The viewer item for one gallery entry.
 *
 * Built by the same helper the conversation uses, so an attachment opened from
 * the gallery carries what it would carry opened from its message: the poster
 * (`thumb`), the message id, and the report target — the MESSAGE, never the URL.
 * Entries that did not come from a confirmed message from someone else (own
 * messages, optimistic ones, links pulled out of text) simply have no `report`.
 */
export function galleryViewerItem(m) {
  const type = m.type || (/\.(mp4|mov|mkv|webm)/i.test(m.url || '') ? 'video' : 'image');
  return chatMediaItem(m.url, type, { thumb: m.thumbnailUrl, id: m.id, report: m.report });
}

export default function ChatGalleryPage({ mediaList, onBack, hasMore, isLoadingMore, onLoadMore }) {
  const { openViewer } = useMediaViewerActions();

  const openAt = useCallback((index) => {
    openViewer((mediaList || []).map(galleryViewerItem), index);
  }, [mediaList, openViewer]);

  const total = mediaList ? mediaList.length : 0;
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
      
      <div className={sharedStyles.scrollBody} key="gallery-scroll">
        {total > 0 ? (
          <div className={styles.galleryGrid}>
            {mediaList.map((item, idx) => (
              <MediaThumb
                key={`${item.url}-${idx}`}
                src={item.url}
                poster={item.thumbnailUrl}
                type={item.type}
                alt=""
                ariaLabel={galleryTileLabel(item, idx, total)}
                onClick={() => openAt(idx)}
                className={styles.galleryGridItem}
              />
            ))}
          </div>
        ) : (
          <div className={sharedStyles.noMediaContainer} style={{ padding: '4rem 1rem', justifyContent: 'center', flexDirection: 'column', gap: '0.75rem' }}>
            <ImageIcon size={36} className={sharedStyles.noMediaIcon} />
            <span style={{ fontSize: '0.95rem' }}>No media</span>
          </div>
        )}
        <div style={{ padding: '0 1.25rem 1.25rem' }}>
          <GalleryCoverageNote hasMore={hasMore} isLoadingMore={isLoadingMore} onLoadMore={onLoadMore} />
        </div>
      </div>
    </div>
  );
}
