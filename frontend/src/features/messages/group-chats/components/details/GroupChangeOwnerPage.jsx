import styles from './ChatDetailsPanel.module.css';
import Avatar from '@shared/components/avatar/Avatar';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import { useAuth } from '@shared/context/AuthContext';

export default function GroupChangeOwnerPage({
  conversation,
  users,
  memberIds,
  onBack,
  targetUserId,
  showConfirm,
  confirmType,
  onSetConfirmTarget,
  onCancelConfirm,
  onConfirmAction
}) {
  const { currentUser } = useAuth();

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button 
          type="button" 
          className={styles.backBtn} 
          onClick={onBack} 
          title="Back"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
        </button>
        <h2 className={styles.headerTitle}>Change Owner</h2>
        <div style={{ width: '40px' }} />
      </div>
      
      <div className={styles.scrollBody} style={{ padding: '0 1rem' }}>
        <p style={{ margin: '1rem 0', color: '#888', fontSize: '0.9rem' }}>
          Select a new owner from the group members. They will have full control over the group settings.
        </p>
        <div className={styles.section} style={{ padding: '0 0.4rem', marginTop: '0' }}>
          <div className={styles.memberList}>
            {memberIds.map(uid => {
              const userObj = Object.values(users).find(u => u.id === uid);
              if (!userObj || uid === conversation.ownerId || uid === currentUser?.id) return null;
              
              return (
                <div key={uid} className={`${styles.memberItem} ${styles.noHover}`}>
                  <div style={{ display: 'flex', alignItems: 'center', flex: 1, gap: '12px', minWidth: 0, marginRight: '8px' }}>
                    <Avatar src={userObj.avatar} name={userObj.name} size="38px" />
                    <div className={styles.memberMeta}>
                      <span className={styles.memberName}>{userObj.displayName || userObj.name}</span>
                      <span className={styles.memberUsername}>@{userObj.username}</span>
                    </div>
                  </div>
                  <div className={styles.memberRight}>
                    <button 
                      className={styles.settingsBtn} 
                      style={{ padding: '8px 14px', fontSize: '0.82rem', width: 'auto', whiteSpace: 'nowrap', flexShrink: 0, marginBottom: 0, fontWeight: '600' }}
                      onClick={() => onSetConfirmTarget(uid)}
                    >
                      Make Owner
                    </button>
                  </div>
                </div>
              );
            })}
            {memberIds.filter(uid => uid !== conversation.ownerId && uid !== currentUser?.id).length === 0 && (
              <p className={styles.sectionValue} style={{ textAlign: 'center', marginTop: '2rem' }}>
                No other members available.
              </p>
            )}
          </div>
        </div>
      </div>
      <ConfirmModal
        title="Change Group Owner?"
        desc={`Ownership of this group will be transferred to ${(Object.values(users).find(u => u.id === targetUserId)?.displayName || Object.values(users).find(u => u.id === targetUserId)?.name || 'This member')}.`}
        visible={showConfirm && confirmType === 'changeOwner'}
        onCancel={onCancelConfirm}
        onConfirm={onConfirmAction}
        confirmText="Change Owner"
      />
    </div>
  );
}
