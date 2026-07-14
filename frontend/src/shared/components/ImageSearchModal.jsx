import { useState, useEffect, useRef } from 'react';
import styles from './ImageSearchModal.module.css';
import { X, Search, Upload } from 'lucide-react';

export default function ImageSearchModal({ onClose, onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('images'); // 'images' or 'gifs'
  const fileInputRef = useRef(null);

  useEffect(() => {
    let active = true;
    const fetchResults = async () => {
      setIsLoading(true);
      if (activeTab === 'images') {
        // Fetch from Unsplash
        const UNSPLASH_KEY = 'SxGAVwx8aEF9osPkgp-cJIUXANI2f09pfNekVmXG1Tg';
        
        try {
          if (!query.trim()) {
            const queries = ['parties', 'meeting', 'workshops', 'events'];
            const fetchPromises = queries.map(q =>
              fetch(`https://api.unsplash.com/search/photos?client_id=${UNSPLASH_KEY}&query=${q}&per_page=8`).then(r => r.json())
            );
            const resultsArr = await Promise.all(fetchPromises);
            
            if (active) {
              let combined = [];
              resultsArr.forEach(data => {
                if (data.results) combined = combined.concat(data.results);
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
        const GIPHY_KEY = '35QtJis0Cfz6gKm69lNb05GJw7lBzzpi';
        
        try {
          if (!query.trim()) {
            const queries = ['parties', 'meeting', 'workshops', 'events'];
            const fetchPromises = queries.map(q =>
              fetch(`https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${q}&limit=8&rating=g`).then(r => r.json())
            );
            const resultsArr = await Promise.all(fetchPromises);
            
            if (active) {
              let combined = [];
              resultsArr.forEach(data => {
                if (data.data) combined = combined.concat(data.data);
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

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          onSelect(event.target.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  return (
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
              autoFocus
            />
          </div>

          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />

          <button
            type="button"
            className={styles.uploadBtn}
            onClick={handleUploadClick}
          >
            <Upload size={14} style={{ marginRight: '6px' }} />
            Upload Image
          </button>
        </div>

        <div className={styles.isBody}>
          {isLoading ? (
            <div className={styles.isLoading}>Loading...</div>
          ) : (
            <div className={styles.isGrid}>
              {results.map(item => (
                <button key={item.id} className={styles.isResultBtn} onClick={() => onSelect(item.url)}>
                  <img src={item.url} alt={item.title} loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
