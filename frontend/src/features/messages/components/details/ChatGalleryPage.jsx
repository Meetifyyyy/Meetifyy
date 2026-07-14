import sharedStyles from './ChatDetailsPanel.module.css';
import styles from './ChatGalleryPage.module.css';

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
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
        </button>
        <h2 className={sharedStyles.headerTitle}>Gallery</h2>
        <div style={{ width: '40px' }} />
      </div>
      
      <div className={sharedStyles.scrollBody} key="gallery-scroll">
        <div className={styles.galleryGrid}>
          {mediaList.map((item, idx) => (
            <div key={idx} className={styles.galleryGridItem}>
              {item.type === 'video' ? (
                <div className={sharedStyles.videoGridWrapper}>
                  <video src={item.url} className={styles.galleryGridMedia} controls />
                </div>
              ) : (
                <img src={item.url} alt="" className={styles.galleryGridMedia} onClick={() => window.open(item.url, '_blank')} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
