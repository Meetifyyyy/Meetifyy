import { useNavigate } from 'react-router-dom';
import { useTrendingHashtags } from '@shared/hooks/useTrendingHashtags';
import { hashtagSearchPath } from '@shared/utils/hashtags';
import panel from './RightPanel.module.css';
import styles from './TrendingHashtags.module.css';

/** Rows shown in the sidebar; the server returns up to ten. */
const SHOWN = 5;

/**
 * "Trending on campus": the hashtags rising fastest among the viewer's
 * college, each opening the posts that carry it. Renders nothing until there
 * is something to show — an empty or loading panel is noise in a sidebar.
 */
export default function TrendingHashtags() {
  const navigate = useNavigate();
  const { scope, tags } = useTrendingHashtags();
  if (tags.length === 0) return null;

  return (
    <div className={panel.panelCard}>
      <h3 className={panel.panelTitle}>
        {scope === 'campus' ? 'Trending on campus' : 'Trending on Meetifyy'}
      </h3>
      <div className={styles.list}>
        {tags.slice(0, SHOWN).map((t, i) => (
          <button
            key={t.name}
            type="button"
            className={styles.row}
            onClick={() => navigate(hashtagSearchPath(t.name))}
          >
            <span className={styles.rank}>{i + 1}</span>
            <span className={styles.text}>
              <span className={styles.tag}>#{t.name}</span>
              <span className={styles.meta}>
                {t.authors} {t.authors === 1 ? 'person' : 'people'} posting
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
