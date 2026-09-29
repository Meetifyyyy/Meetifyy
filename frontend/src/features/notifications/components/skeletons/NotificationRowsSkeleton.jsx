import RowSkeleton from '@shared/components/skeletons/RowSkeleton';
import pageStyles from '../../pages/NotificationsRoute.module.css';
import styles from './NotificationsSkeleton.module.css';

/**
 * The notification list while its first page loads: one group card of
 * avatar + two-line rows, the same shape the loaded list takes.
 *
 * The group's date heading is held open as blank space rather than drawn as a
 * block, so the card does not move when the real heading arrives.
 */
export default function NotificationRowsSkeleton({ count = 6, label = 'Loading notifications' }) {
  return (
    <div className={pageStyles.group}>
      <div className={pageStyles.groupTitle} aria-hidden="true">&nbsp;</div>
      <RowSkeleton
        count={count}
        lines={2}
        avatarSize="46px"
        rowClassName={styles.row}
        className={pageStyles.groupItems}
        label={label}
      />
    </div>
  );
}
