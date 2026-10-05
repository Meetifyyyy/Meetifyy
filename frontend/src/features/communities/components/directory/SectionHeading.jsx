import styles from './CommunityList.module.css';

/**
 * What a Communities tab is, said once: a strong title and one short line under it.
 *
 * The tab used to open with a small label and a row of metadata (a count, "most
 * active first", "Public and private") on top of a block of explanation in its
 * empty state. The tab bar already says where you are, so this does not
 * describe the screen - it sets its tone and gets out of the way.
 */
export default function SectionHeading({ title, subtitle }) {
  return (
    <header className={styles.heading}>
      <h2 className={styles.headingTitle}>{title}</h2>
      {subtitle && <p className={styles.headingSubtitle}>{subtitle}</p>}
    </header>
  );
}
