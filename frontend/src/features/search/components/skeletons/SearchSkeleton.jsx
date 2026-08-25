import { Search, ArrowLeft } from '@shared/components/icons';
import PageLayout from '@layout/PageLayout';
import Skeleton from '@shared/components/skeletons/Skeleton';
import styles from '@features/search/pages/SearchResultsRoute.module.css';

/**
 * Route-level Suspense fallback for /search while the page chunk loads.
 *
 * Reuses SearchResultsRoute's own shell + CSS module so the STATIC chrome —
 * back button and search bar — appears instantly and pixel-identical to the
 * loaded page (no layout jump on mount). Only the dynamic result rows are
 * skeletons, matching the in-component `isLoading` state exactly, so the
 * fallback → mounted → results transition is seamless.
 */
export default function SearchSkeleton() {
  return (
    <PageLayout className="centre--search">
      <div className={styles.searchShell}>
        {/* Sticky header — real back button + search bar, shown instantly */}
        <div className={styles.header} role="search">
          <div className={styles.topRow}>
            <button className={styles.backBtn} aria-label="Go back" tabIndex={-1}>
              <ArrowLeft size={20} />
            </button>
            <div className={styles.searchPill}>
              <Search size={18} className={styles.searchPillIcon} aria-hidden="true" />
              <input
                className={styles.searchInput}
                placeholder="Search..."
                aria-label="Search field"
                disabled
              />
            </div>
          </div>
        </div>

        {/* Dynamic content — skeleton rows, identical to the loading state */}
        <div className={styles.body}>
          <div className={styles.resultsList}>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className={styles.skeletonCard}>
                <Skeleton type="circle" width="46px" height="46px" />
                <div className={styles.skeletonCol}>
                  <Skeleton type="text" width="40%" height="16px" />
                  <Skeleton type="text" width="65%" height="13px" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
