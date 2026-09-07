import { useParams } from 'react-router-dom';
import Skeleton from '@shared/components/skeletons/Skeleton';
import styles from './SettingsSkeleton.module.css';

/**
 * The loading state for Settings.
 *
 * A skeleton is only worth rendering if it is the shape of what replaces it —
 * otherwise it is a second layout the user watches collapse into the real one.
 * This one had drifted: it drew three labelled sections of seven flat rows and
 * a detail pane built around an avatar and a form, from before Settings was
 * grouped into categories. What actually mounts is one card of six category
 * rows — icon, label, description — a Log Out card below it, and, until
 * something is chosen, a centred brand panel rather than a form.
 *
 * So the structure here is derived from the same shape SettingsRoute renders:
 * same gutter, same 36px icon tile, same two-line row, same card grouping.
 *
 * ROW_WIDTHS varies the label and description widths per row. Uniform bars read
 * as a table; real labels are ragged, and the eye reads the ragged one as text
 * that has not arrived rather than as content that is missing.
 */
const ROW_WIDTHS = [
  { label: '84px', desc: '190px' },
  { label: '132px', desc: '168px' },
  { label: '146px', desc: '176px' },
  { label: '78px', desc: '158px' },
  { label: '112px', desc: '104px' },
  { label: '134px', desc: '182px' },
];

function SkeletonRow({ label, desc }) {
  return (
    <div className={styles.rowItem}>
      <Skeleton type="rect" width="36px" height="36px" style={{ borderRadius: '10px' }} />
      <div className={styles.rowText}>
        <Skeleton type="rect" width={label} height="13px" style={{ borderRadius: '4px' }} />
        {desc && (
          <Skeleton type="rect" width={desc} height="10px" style={{ borderRadius: '4px' }} />
        )}
      </div>
      <Skeleton type="rect" width="8px" height="14px" style={{ borderRadius: '3px' }} />
    </div>
  );
}

/** The root list — the six category cards and Log Out. */
function ListPaneSkeleton() {
  return (
    <div className={styles.bodyContent}>
      <div className={styles.cardGroup}>
        {ROW_WIDTHS.map((w, i) => (
          <div key={i}>
            {i > 0 && <div className={styles.rowDivider} />}
            <SkeletonRow label={w.label} desc={w.desc} />
          </div>
        ))}
      </div>

      <div className={styles.cardGroup}>
        <SkeletonRow label="66px" />
      </div>
    </div>
  );
}

export default function SettingsSkeleton() {
  const { panel } = useParams();
  const hasActivePanel = Boolean(panel);

  return (
    <main className="centre centre-wide centre--sheet animate-in">
      <div className={styles.page}>
        <header className={styles.topBar}>
          <Skeleton type="rect" width="36px" height="36px" style={{ borderRadius: '50%' }} />
          <Skeleton type="rect" width="88px" height="16px" style={{ borderRadius: '6px' }} />
          {/* Matches the real spacer, so the title sits in the same place */}
          <div style={{ width: 36 }} />
        </header>

        <div className={styles.splitBody}>
          <div className={`${styles.listPane} ${hasActivePanel ? styles.hideMobileList : ''}`}>
            <ListPaneSkeleton />
          </div>

          {/* On large screens the right pane is where a category's settings or a
              panel lands. Which of the two is coming is not knowable from the
              URL alone — a slug can be either — so this draws the neutral form
              of both: a card of rows the width of a settings list. */}
          <div className={`${styles.detailPane} ${!hasActivePanel ? styles.hideMobileDetail : ''}`}>
            <div className={styles.bodyContent}>
              <div className={styles.cardGroup}>
                {['128px', '150px', '112px', '138px'].map((w, i) => (
                  <div key={w}>
                    {i > 0 && <div className={styles.rowDivider} />}
                    <div className={styles.detailRow}>
                      <Skeleton type="rect" width={w} height="13px" style={{ borderRadius: '4px' }} />
                      <Skeleton type="rect" width="100%" height="34px" style={{ borderRadius: '10px' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
