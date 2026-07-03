import { useSmartBack } from '../../hooks/useSmartBack';
import styles from './CrewHeader.module.css';

export default function CrewHeader({ 
  selectedTab, onTabChange, 
  searchQuery, onSearchChange
}) {
  const goBack = useSmartBack();

  return (
    <div className={styles.headerContainer}>
      
      {/* Mobile back row */}
      <div className={styles.mobileBackRow}>
        <button className={styles.backBtn} onClick={() => goBack('/home')} aria-label="Go back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </button>
        <h1 className={styles.backTitle}>Crew</h1>
      </div>

      {/* Search Bar */}
      <div className={styles.searchRow}>
        <div className={styles.searchBox}>
          <svg className={styles.searchIcon} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input 
            type="text" 
            className={styles.searchInput}
            placeholder="Search activities, people or interests..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      {/* Tabs Row */}
      <div className={styles.tabsRow}>
        <nav className={styles.tabsNav}>
          {['For You', 'Popular', 'My Activities', 'Saved'].map(tab => (
            <button 
              key={tab}
              className={`${styles.tabBtn} ${selectedTab === tab ? styles.tabActive : ''}`}
              onClick={() => onTabChange(tab)}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>
      
    </div>
  );
}
