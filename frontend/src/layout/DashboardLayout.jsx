import styles from './DashboardLayout.module.css';

export default function DashboardLayout({ wide, compactGutters, noPaddingMobile, children }) {
  return (
    <div className={`${styles.dashboard}${wide ? ` ${styles.dashboardWide}` : ''}${compactGutters ? ` ${styles.dashboardCompact}` : ''}${noPaddingMobile ? ` ${styles.noPaddingMobile}` : ''}`}>
      {children}
    </div>
  );
}
