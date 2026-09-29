import { useParams } from 'react-router-dom';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import styles from './SettingsSkeleton.module.css';

/**
 * Shown only while the Settings chunk loads.
 *
 * Everything on the Settings root is static - the category rows, their icons,
 * Log Out - and it all arrives with the chunk, in one frame. There is no data
 * to wait for, so there is nothing a skeleton could honestly stand for:
 * drawing grey icon tiles, label bars and chevrons only produced a second
 * layout (which had already drifted from the real one twice) that the page
 * then snapped into.
 *
 * So this renders the real frame and the real top bar - a working back button
 * and the title - and leaves the body empty for the instant before the list
 * lands. On a panel URL the title is left blank rather than guessed: the panel
 * names live with the page, and a wrong title that then changes is worse than
 * none.
 */
export default function SettingsSkeleton() {
  const { panel } = useParams();
  const goBack = useSmartBack();

  return (
    <main className="centre centre-wide centre--sheet animate-in">
      <div className={styles.page}>
        <header className={styles.topBar}>
          <button
            type="button"
            className={styles.backBtn}
            aria-label="Go back"
            onClick={() => goBack(panel ? '/settings' : '/home')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>

          <span className={styles.topBarTitle}>{panel ? '' : 'Settings'}</span>

          {/* Matches the real spacer (the back button's width), so the title
              sits in the same place. */}
          <div style={{ width: 40 }} />
        </header>

        <div className={styles.splitBody}>
          <div className={styles.listPane} />
          <div className={styles.detailPane} />
        </div>
      </div>
    </main>
  );
}
