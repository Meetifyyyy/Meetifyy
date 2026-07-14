import { useState } from 'react';
import { useAuth } from '@shared/context/AuthContext';
import { useData } from '@shared/context/DataContext';
import { Link } from 'react-router-dom';
import DefaultAvatar from '@shared/components/DefaultAvatar';
import ConfirmModal from '@shared/components/ConfirmModal';
import { isImageUrl } from '@shared/utils/avatar';
import CalendarIcon from '@shared/components/CalendarIcon';
import styles from './ActivityChatDetailsModal.module.css';

export default function ActivityChatDetailsModal({ conversation, onClose, onEndActivity }) {
  const { currentUser } = useAuth();
  const { crewActivities, users, endCrewActivity } = useData();
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  if (!conversation || !conversation.activityId) return null;

  const activity = crewActivities.find(a => a.id === conversation.activityId);
  if (!activity) return null;

  const isHost = activity.hostId === currentUser?.id;

  const handleEndActivity = () => {
    setShowEndConfirm(true);
  };

  const confirmEndActivity = async () => {
    setShowEndConfirm(false);
    await endCrewActivity(activity.id);
    if (onEndActivity) onEndActivity();
    else onClose();
  };

  // Use conversation participants or fallback to activity participants
  const participantIds = conversation.participants || activity.participants || [];

  return (
    <>
      <div className={styles.overlay} onClick={onClose}>
        <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>{activity.title}</h2>
          <button className={styles.closeBtn} onClick={onClose} title="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Activity Details</h3>
            <div className={styles.detailCard}>
              <div className={styles.detailItem} style={{ gap: '0.75rem', alignItems: 'center' }}>
                <CalendarIcon date={activity.date} dateLabel={activity.dateLabel} />
                <div className={styles.detailText} style={{ fontWeight: '500' }}>{activity.date}</div>
              </div>
              <div className={styles.detailItem}>
                <svg className={styles.detailIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <div className={styles.detailText}>{activity.time}</div>
              </div>
              <div className={styles.detailItem}>
                <svg className={styles.detailIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <div className={styles.detailText}>{activity.location}</div>
              </div>
              {activity.description && (
                <div className={styles.detailItem}>
                  <svg className={styles.detailIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="4" y1="6" x2="20" y2="6" />
                    <line x1="4" y1="12" x2="20" y2="12" />
                    <line x1="4" y1="18" x2="12" y2="18" />
                  </svg>
                  <div className={styles.detailText}>{activity.description}</div>
                </div>
              )}
            </div>
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Members ({participantIds.length})</h3>
            <div className={styles.membersList}>
              {participantIds.map(uid => {
                // Find user by ID (assuming users is an object with username as keys, we need to search)
                const userObj = Object.values(users).find(u => u.id === uid);
                
                if (!userObj) return null;
                return (
                  <Link key={uid} to={`/profile/${userObj.username}`} className={styles.memberItem} onClick={onClose}>
                    {isImageUrl(userObj.avatar) ? (
                      <img src={userObj.avatar} alt={userObj.name} className={styles.memberAvatar} />
                    ) : (
                      <div className={styles.memberAvatar} style={{ background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <DefaultAvatar />
                      </div>
                    )}
                    <div className={styles.memberInfo}>
                      <span className={styles.memberName}>{(userObj.displayName || userObj.name)} {activity.hostId === uid && '(Host)'}</span>
                      <span className={styles.memberUsername}>@{userObj.username}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
            {isHost && (
              <button className={styles.endBtn} onClick={handleEndActivity}>
                End Activity
              </button>
            )}
          </div>
        </div>
      </div>
      </div>
      <ConfirmModal
        title="End Activity"
        desc="Are you sure you want to end this activity? This will also delete the group chat."
        visible={showEndConfirm}
        onCancel={() => setShowEndConfirm(false)}
        onConfirm={confirmEndActivity}
        confirmText="End Activity"
      />
    </>
  );
}
