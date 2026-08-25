import { Link } from 'react-router-dom';
import Avatar from '@shared/components/avatar/Avatar';
import { Check, X, UserCheck, ArrowLeft } from '@shared/components/icons';
import sharedStyles from './ChatDetailsPanel.module.css';
import styles from './GroupJoinRequestsPage.module.css';

export default function GroupJoinRequestsPage({
  pendingRequests = [],
  users = {},
  onAccept,
  onReject,
  onBack
}) {
  return (
    <div className={sharedStyles.container}>
      {/* Header */}
      <div className={sharedStyles.header}>
        <button 
          type="button" 
          className={sharedStyles.backBtn} 
          onClick={onBack} 
          title="Back"
        >
          <ArrowLeft size={20} />
        </button>
        <h2 className={sharedStyles.headerTitle}>Join Requests</h2>
        <div style={{ width: '40px' }} />
      </div>

      {/* Body */}
      <div className={sharedStyles.scrollBody} key="join-requests-scroll">
        {pendingRequests && pendingRequests.length > 0 ? (
          <div className={styles.requestsList}>
            {pendingRequests.map(item => {
              const uid = typeof item === 'string' ? item : (item.userId || item.user?.id);
              const embeddedUser = typeof item === 'object' ? item.user : null;
              const globalUser = Object.values(users || {}).find(u => String(u.id) === String(uid));
              const userObj = embeddedUser || globalUser || { id: uid, username: 'user', displayName: 'Member' };

              const name = userObj.displayName || userObj.name || userObj.username || 'User';
              const username = userObj.username ? `@${userObj.username}` : '';

              return (
                <div key={uid} className={styles.requestCard}>
                  <Link to={`/profile/${userObj.username || uid}`} className={styles.requestUserLink}>
                    <Avatar 
                      src={userObj.avatar} 
                      name={name} 
                      size="44px" 
                    />
                    <div className={styles.requestUserMeta}>
                      <span className={styles.requestUserName}>{name}</span>
                      {username && <span className={styles.requestUserHandle}>{username}</span>}
                    </div>
                  </Link>

                  <div className={styles.requestActionRow}>
                    <button
                      type="button"
                      className={styles.approveBtn}
                      onClick={() => onAccept(uid)}
                      title="Accept Request"
                    >
                      <Check size={18} />
                    </button>
                    <button
                      type="button"
                      className={styles.rejectBtn}
                      onClick={() => onReject(uid)}
                      title="Reject Request"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className={styles.noRequestsContainer}>
            <UserCheck size={40} className={styles.noRequestsIcon} />
            <span className={styles.noRequestsTitle}>No Pending Requests</span>
            <span className={styles.noRequestsSub}>When people ask to join this group, their requests will appear here.</span>
          </div>
        )}
      </div>
    </div>
  );
}
