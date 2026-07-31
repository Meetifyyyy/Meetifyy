import sharedStyles from './ChatDetailsPanel.module.css';
import styles from './ChatGalleryPage.module.css';
import { sanitizeUrl } from '@shared/utils/urlSanitize';
import { Image as ImageIcon, ArrowLeft, Play } from 'lucide-react';
import { useMediaViewer } from '@shared/context/MediaViewerContext';

export default function ChatGalleryPage({ mediaList, onBack }) {
  const { openViewer } = useMediaViewer();
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
              <div 
                key={idx} 
                className={styles.galleryGridItem}
                onClick={() => {
                  const formattedItems = mediaList.map(m => ({
                    url: m.url,
                    type: m.type || (/\.(mp4|mov|mkv)/i.test(m.url) ? 'video' : 'image')
                  }));
                  openViewer(formattedItems, idx);
                }}
                style={{ cursor: 'pointer' }}
              >
                {item.type === 'video' ? (
                  <div className={sharedStyles.videoGridWrapper} style={{ position: 'relative', width: '100%', height: '100%' }}>
                    <video src={item.url} className={styles.galleryGridMedia} style={{ objectFit: 'cover' }} />
                    <div style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      background: 'rgba(0,0,0,0.5)',
                      borderRadius: '50%',
                      padding: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <Play size={16} fill="white" color="white" />
                    </div>
                  </div>
                ) : (
                  <img src={item.url} alt="" className={styles.galleryGridMedia} />
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
