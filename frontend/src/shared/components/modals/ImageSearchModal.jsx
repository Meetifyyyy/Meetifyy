import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './ImageSearchModal.module.css';
import { X, Search, Upload, Loader2 } from 'lucide-react';
import { processAndUploadImage } from '@shared/utils/mediaPipeline';
import { compressAndCacheDraftImage } from '@shared/utils/draftImageCache';
import MediaCropper from '@shared/components/media/MediaCropper';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { showToast } from '@shared/utils/toast';
import { config } from '@config';

/**
 * `theme` re-applies a colour scope to the portalled content. Portalling to
 * <body> escapes any `data-theme` wrapper at the call site, so a caller that
 * forces its own scheme (e.g. the always-dark Create Activity page) must say so
 * explicitly or the modal would render with the app's default tokens.
 */
export default function ImageSearchModal({ onClose, onSelect, theme }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCompressingRemote, setIsCompressingRemote] = useState(false);
  const [activeTab, setActiveTab] = useState('images'); // 'images' or 'gifs'
  const [cropTarget, setCropTarget] = useState(null);
  const fileInputRef = useRef(null);
  // Only the most recent selection may call onSelect. Without this, picking
  // image A then quickly picking image B lets A's slower compression resolve
  // last and clobber B.
  const selectionTokenRef = useRef(0);
  const isCurrent = (token) => token === selectionTokenRef.current;

  useOverlayBack(true, onClose, { pushHistoryState: false });
  useScrollLock(true);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);


  useEffect(() => {
    let active = true;
    const fetchResults = async () => {
      setIsLoading(true);
      if (activeTab === 'images') {
        // Fetch from Unsplash
        const UNSPLASH_KEY = config.integrations.unsplashKey;
        
        try {
          if (!query.trim()) {
            const queries = ['parties', 'meeting', 'workshops', 'events'];
            const fetchPromises = queries.map(q =>
              fetch(`https://api.unsplash.com/search/photos?client_id=${UNSPLASH_KEY}&query=${q}&per_page=8`).then(r => r.json())
            );
            const resultsArr = await Promise.all(fetchPromises);
            
            if (active) {
              let combined = [];
              const seen = new Set();
              resultsArr.forEach(data => {
                if (data.results) {
                  data.results.forEach(photo => {
                    if (!seen.has(photo.id)) {
                      seen.add(photo.id);
                      combined.push(photo);
                    }
                  });
                }
              });
              setResults(combined.map(photo => ({
                id: photo.id,
                url: photo.urls.regular,
                title: photo.alt_description || 'Image'
              })));
            }
          } else {
            const endpoint = `https://api.unsplash.com/search/photos?client_id=${UNSPLASH_KEY}&query=${encodeURIComponent(query)}&per_page=30`;
            const res = await fetch(endpoint);
            const data = await res.json();
            if (active && data.results) {
              setResults(data.results.map(photo => ({
                id: photo.id,
                url: photo.urls.regular,
                title: photo.alt_description || 'Image'
              })));
            }
          }
        } catch (err) {
          console.error('Error fetching Unsplash images:', err);
        } finally {
          if (active) setIsLoading(false);
        }
      } else {
        // Fetch from Giphy
        const GIPHY_KEY = config.integrations.giphyKey;
        
        try {
          if (!query.trim()) {
            const queries = ['parties', 'meeting', 'workshops', 'events'];
            const fetchPromises = queries.map(q =>
              fetch(`https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${q}&limit=8&rating=g`).then(r => r.json())
            );
            const resultsArr = await Promise.all(fetchPromises);
            
            if (active) {
              let combined = [];
              const seen = new Set();
              resultsArr.forEach(data => {
                if (data.data) {
                  data.data.forEach(gif => {
                    if (!seen.has(gif.id)) {
                      seen.add(gif.id);
                      combined.push(gif);
                    }
                  });
                }
              });
              setResults(combined.map(gif => ({
                id: gif.id,
                url: gif.images.original.url,
                title: gif.title
              })));
            }
          } else {
            const endpoint = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(query)}&limit=30&rating=g`;
            const res = await fetch(endpoint);
            const data = await res.json();
            if (active && data.data) {
              setResults(data.data.map(gif => ({
                id: gif.id,
                url: gif.images.original.url,
                title: gif.title
              })));
            }
          }
        } catch (err) {
          console.error('Error fetching GIFs:', err);
        } finally {
          if (active) setIsLoading(false);
        }
      }
    };

    const timeout = setTimeout(() => {
      fetchResults();
    }, 400);

    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [query, activeTab]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleCustomUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
      if (!file.type.startsWith('image/')) {
        showToast('Only image files allowed', 'error');
        e.target.value = '';
        return;
      }
      if (file.size > MAX_SIZE) {
        showToast('File size limit is 10 MB', 'error');
        e.target.value = '';
        return;
      }
      if (file.type === 'image/gif') {
        const token = ++selectionTokenRef.current;
        setIsCompressingRemote(true);
        compressAndCacheDraftImage(file).then(({ previewUrl }) => {
          if (!isCurrent(token)) return;
          if (!previewUrl) throw new Error('No preview produced');
          onSelect(previewUrl);
          onClose();
        }).catch(() => {
          if (!isCurrent(token)) return;
          // Don't hand back a raw object URL — that bypasses the media pipeline
          // and would later be persisted as a dead blob: reference.
          showToast('Could not process that GIF. Please try another.', 'error');
        }).finally(() => {
          if (isCurrent(token)) setIsCompressingRemote(false);
        });
      } else {
        setCropTarget(file);
      }
    }
    e.target.value = '';
  };

  const isGifUrl = (url) => {
    if (!url || typeof url !== 'string') return false;
    return url.includes('.gif') || url.includes('giphy.com') || url.startsWith('data:image/gif');
  };

  const handleSelectItem = async (itemUrl) => {
    if (activeTab === 'gifs' || isGifUrl(itemUrl)) {
      const token = ++selectionTokenRef.current;
      setIsCompressingRemote(true);
      try {
        const { previewUrl } = await compressAndCacheDraftImage(itemUrl);
        if (!isCurrent(token)) return;
        // previewUrl may be absent when the remote fetch failed; the raw remote
        // URL is still a valid cover source that commitDraftImage can upload.
        onSelect(previewUrl || itemUrl);
        onClose();
      } catch (_) {
        if (!isCurrent(token)) return;
        showToast('Could not load that GIF. Please try another.', 'error');
      } finally {
        if (isCurrent(token)) setIsCompressingRemote(false);
      }
    } else {
      setCropTarget(itemUrl);
    }
  };

  const handleCropComplete = async (croppedFile) => {
    const token = ++selectionTokenRef.current;
    setIsCompressingRemote(true);
    try {
      const { previewUrl } = await compressAndCacheDraftImage(croppedFile, { maxWidthOrHeight: 1280 });
      if (!isCurrent(token)) return;
      if (!previewUrl) throw new Error('No preview produced');
      onSelect(previewUrl);
      setCropTarget(null);
      onClose();
    } catch (e) {
      if (!isCurrent(token)) return;
      console.error('Failed to compress image:', e);
      // Stay open with the cropper dismissed so the user can retry or pick
      // something else, rather than closing on a failure that selected nothing.
      showToast('Image processing failed. Please try again.', 'error');
      setCropTarget(null);
    } finally {
      if (isCurrent(token)) setIsCompressingRemote(false);
    }
  };

  return createPortal(
    <div data-theme={theme} style={{ display: 'contents' }}>
      <div className={styles.modalOverlay} onClick={onClose}>
        <div className={styles.isModal} onClick={e => e.stopPropagation()}>
          <div className={styles.isHeader}>
            <div className={styles.isTitleRow}>
              <span className={styles.dtTitle}>Pick a cover</span>
              <button className={styles.dtClose} onClick={onClose}><X size={16} /></button>
            </div>
            
            <div className={styles.isTabs}>
              <button className={`${styles.isTab} ${activeTab === 'images' ? styles.isTabActive : ''}`} onClick={() => setActiveTab('images')}>Images</button>
              <button className={`${styles.isTab} ${activeTab === 'gifs' ? styles.isTabActive : ''}`} onClick={() => setActiveTab('gifs')}>GIFs</button>
            </div>

            <div className={styles.isSearchBox}>
              <Search size={16} className={styles.isSearchIcon} />
              <input 
                type="text" 
                className={styles.isSearchInput} 
                placeholder={`Search for ${activeTab}...`}
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>

            <input
              type="file"
              accept="image/*"
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={handleCustomUpload}
            />

            <button
              type="button"
              className={styles.uploadBtn}
              onClick={handleUploadClick}
              disabled={isCompressingRemote}
            >
              {isCompressingRemote ? (
                <>
                  <Loader2 size={14} style={{ marginRight: '6px', animation: 'spin 1s linear infinite' }} />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload size={14} style={{ marginRight: '6px' }} />
                  Upload Image
                </>
              )}
            </button>
          </div>

          <div className={styles.isBody}>
            {results.length === 0 && isLoading ? (
              <div className={styles.isGrid}>
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className={styles.skeletonCard} />
                ))}
              </div>
            ) : results.length === 0 ? (
              <div className={styles.isLoading}>
                No items found.
              </div>
            ) : (
              <div className={`${styles.isGrid} ${isLoading ? styles.isGridLoading : ''}`}>
                {results.map(item => (
                  <button key={item.id} className={styles.isResultBtn} onClick={() => handleSelectItem(item.url)}>
                    <img src={item.url} alt={item.title} loading="lazy" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {cropTarget && (
        <MediaCropper
          imageFile={cropTarget}
          aspect={1}
          onCropComplete={handleCropComplete}
          onCancel={() => setCropTarget(null)}
        />
      )}
    </div>,
    document.body,
  );
}
