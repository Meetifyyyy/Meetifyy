import sharedStyles from './ChatDetailsPanel.module.css';
import styles from './ChatGalleryPage.module.css';
import { sanitizeUrl } from '@shared/utils/urlSanitize';
import { Image as ImageIcon, ArrowLeft } from 'lucide-react';

export default function ChatGalleryPage({ mediaList, onBack }) {
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
              <div key={idx} className={styles.galleryGridItem}>
                {item.type === 'video' ? (
                  <div className={sharedStyles.videoGridWrapper}>
                    <video src={item.url} className={styles.galleryGridMedia} controls />
                  </div>
                ) : (
                  <img src={item.url} alt="" className={styles.galleryGridMedia} onClick={() => {
                    const safe = sanitizeUrl(item.url);
                    if (safe) window.open(safe, '_blank', 'noopener,noreferrer');
                  }} />
                )}
              </div>
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
