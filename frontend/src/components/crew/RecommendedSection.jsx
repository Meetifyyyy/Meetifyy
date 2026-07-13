import { useRef, useState, useEffect } from 'react';
import styles from './RecommendedSection.module.css';

export default function RecommendedSection({ groups, onInvite, onViewProfile }) {
  if (!groups || groups.length === 0) return null;

  return (
    <section className={styles.section}>
      {groups.map(group => (
        <GroupRow
          key={group.context}
          context={group.context}
          items={group.items}
          onInvite={onInvite}
          onViewProfile={onViewProfile}
        />
      ))}
    </section>
  );
}

function GroupRow({ context, items, onInvite, onViewProfile }) {
  const scrollRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => {
      setCanScrollLeft(el.scrollLeft > 0);
      setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10);
    };
    check();
    el.addEventListener('scroll', check);
    return () => el.removeEventListener('scroll', check);
  }, [items]);

  const scroll = (dir) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 340, behavior: 'smooth' });
  };

  return (
    <div className={styles.group}>
      <div className={styles.groupHeader}>
        <h2 className={styles.groupHeading}>{context}</h2>
        <div className={styles.scrollButtons}>
          <button className={`${styles.scrollBtn}${canScrollLeft ? ` ${styles.scrollBtnActive}` : ''}`} onClick={() => scroll(-1)} disabled={!canScrollLeft}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button className={`${styles.scrollBtn}${canScrollRight ? ` ${styles.scrollBtnActive}` : ''}`} onClick={() => scroll(1)} disabled={!canScrollRight}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </div>

      <div className={styles.carousel} ref={scrollRef}>
        {items.map(item => (
          <div key={item.id} className={styles.recommendCard}>
            <p className={styles.recTitle}>{item.title}</p>
            <div className={styles.recCreator}>
              <span>{item.hostName}</span>
              {item.hostCollege && <span className={styles.recCollege}>{item.hostCollege}</span>}
            </div>
            <div className={styles.recMeta}>
              <span>{item.availability}</span>
              <span className={styles.recDot}>·</span>
              <span>{item.distance}</span>
              <span className={styles.recDot}>·</span>
              <span>{item.slotsNeeded - Math.min(item.slotsFilled, item.slotsNeeded)} spots</span>
            </div>
            <div className={styles.recActions}>
              <button className={styles.recPrimary} onClick={() => onInvite(item)}>Join</button>
              <button className={styles.recSecondary} onClick={() => onViewProfile(item)}>Profile</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
