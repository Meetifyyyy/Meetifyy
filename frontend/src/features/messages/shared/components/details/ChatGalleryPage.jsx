import { useCallback } from 'react';
import sharedStyles from './ChatDetailsPanel.module.css';
import styles from './ChatGalleryPage.module.css';
import { Image as ImageIcon, ArrowLeft } from '@shared/components/icons';
import { useMediaViewerActions } from '@shared/context/MediaViewerContext';
import MediaThumb from '@shared/components/media/MediaThumb';

export default function ChatGalleryPage({ mediaList, onBack }) {
  const { openViewer } = useMediaViewerActions();

  const openAt = useCallback((index) => {
    const items = (mediaList || []).map((m) => ({
      url: m.url,
      type: m.type || (/\.(mp4|mov|mkv|webm)/i.test(m.url || '') ? 'video' : 'image'),
    }));
    openViewer(items, index);
  }, [mediaList, openViewer]);
  return (
    <div className={sharedStyles.container}>
      <div className={sharedStyles.header}>
        <button 
          type="button" 
          className={sharedStyles.backBtn} 
          onClick={onBack} 
          title="Back"
        >
          <ArrowLeft size={20} />
        </button>
        <h2 className={sharedStyles.headerTitle}>Gallery</h2>
        <div style={{ width: '40px' }} />
      </div>
      
      <div className={sharedStyles.scrollBody} key="gallery-scroll">
        {mediaList && mediaList.length > 0 ? (
          <div className={styles.galleryGrid}>
            {mediaList.map((item, idx) => (
              <MediaThumb
                key={`${item.url}-${idx}`}
                src={item.url}
                poster={item.thumbnailUrl}
                type={item.type}
                alt=""
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
      </div>
    </div>
  );
}
