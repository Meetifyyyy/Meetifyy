import styles from './CommunityList.module.css';

/** The titled line that opens each Communities tab. */
export default function SectionHeading({ title, meta }) {
  return (
    <div className={styles.heading}>
      <h2 className={styles.headingTitle}>{title}</h2>
      {meta && <span className={styles.headingMeta}>{meta}</span>}
    </div>
  );
}
