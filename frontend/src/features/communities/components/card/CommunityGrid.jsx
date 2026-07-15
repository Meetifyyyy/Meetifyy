import styles from './CommunityGrid.module.css';

export default function CommunityGrid({ children }) {
  return <div className={styles.grid}>{children}</div>;
}
