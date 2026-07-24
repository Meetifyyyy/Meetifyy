import React from 'react';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import styles from './PageHeader.module.css';

export default function PageHeader({
  title,
  subtitle,
  backPath = '/home',
  showBack = true,
  searchBar,
  searchProps,
  actions,
  tabs,
  activeTab,
  onTabChange,
  tabVariant = 'underline',
}) {
  const goBack = useSmartBack();

  return (
    <header className={styles.headerContainer}>
      <div className={styles.titleArea}>
        <div className={styles.mobileTitleRow}>
          {showBack && (
            <button
              type="button"
              className={`${styles.backBtn} ${(title === 'Messages' || title === 'Crew' || title === 'Communities' || title === 'Search') ? styles.hideBackOnMobile : ''}`}
              onClick={() => goBack(backPath)}
              aria-label="Go back"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
          )}
          <h1 className={`${styles.mobileTitle} ${(title === 'Messages' || title === 'Crew' || title === 'Communities' || title === 'Search' || title === 'Notifications') ? styles.changaFont : ''}`}>{title}</h1>
        </div>

        <div className={styles.desktopTitleRow}>
          <h1 className={`${styles.desktopTitle} ${(title === 'Messages' || title === 'Crew' || title === 'Communities' || title === 'Search' || title === 'Notifications') ? styles.changaFont : ''}`}>{title}</h1>
          {subtitle && <p className={styles.desktopSubtitle}>{subtitle}</p>}
        </div>
      </div>

      {(searchBar || searchProps || actions !== undefined) && (
        <div className={styles.searchRow}>
          <div className={styles.searchWrapper}>
            {searchBar || (
              searchProps && (
                <div className={styles.searchBox}>
                  <svg className={styles.searchIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="text"
                    className={styles.searchInput}
                    value={searchProps.value || ''}
                    onChange={searchProps.onChange}
                    placeholder={searchProps.placeholder || 'Search...'}
                    onFocus={searchProps.onFocus}
                    onKeyDown={searchProps.onKeyDown}
                  />
                  {searchProps.value && searchProps.onClear && (
                    <button
                      type="button"
                      className={styles.clearBtn}
                      onClick={searchProps.onClear}
                      aria-label="Clear search"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>
              )
            )}
          </div>

          {actions && (
            <div className={styles.actionSlot}>
              {actions}
            </div>
          )}
        </div>
      )}

      {tabs && tabs.length > 0 && (
        <nav className={`${styles.tabsNav} ${tabVariant === 'pills' ? styles.tabsPills : styles.tabsUnderline}`}>
          {tabs.map((tab) => {
            const id = typeof tab === 'object' ? tab.id : tab;
            const label = typeof tab === 'object' ? tab.label : tab;
            const Icon = typeof tab === 'object' ? tab.icon : null;
            const isActive = activeTab === id;

            return (
              <button
                key={id}
                type="button"
                className={`${styles.tabBtn} ${isActive ? styles.tabActive : ''}`}
                onClick={() => onTabChange && onTabChange(id)}
              >
                {Icon && (
                  typeof Icon === 'string' ? (
                    <span className={styles.tabEmojiIcon}>{Icon}</span>
                  ) : (
                    <Icon size={15} className={styles.tabIcon} />
                  )
                )}
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
      )}
    </header>
  );
}
