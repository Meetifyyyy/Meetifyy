import { useState, useMemo } from 'react';
import { useAuth } from '@shared/context/AuthContext';
import { Link } from 'react-router-dom';
import DefaultAvatar from '@shared/components/avatar/DefaultAvatar';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import { isImageUrl } from '@shared/utils/avatar';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import { CalendarDays } from 'lucide-react';
import styles from './ActivityChatDetailsModal.module.css';
import sidebarStyles from '../../../shared/components/sidebar/ConversationList.module.css';
import { useData } from '@shared/hooks/useData';
import { sortGroupMembers } from '@shared/utils/memberSort';

export default function ActivityChatDetailsModal({ conversation, onClose, onEndActivity }) {
  const { currentUser } = useAuth();
  const { crewActivities, users, endCrewActivity } = useData();

  const cleanActId = String(conversation?.activityId || conversation?.internalId || conversation?.id || '').replace(/^act_/, '');
  const dbActivity = crewActivities.find(a => String(a.id) === cleanActId || String(a.id) === String(conversation?.activityId));
  const activity = dbActivity ? { ...conversation, ...dbActivity } : conversation;

  const isHost = !!(currentUser?.id && (activity.hostId === currentUser.id || activity.creatorId === currentUser.id));
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  const handleEndActivity = () => {
    setShowEndConfirm(true);
  };

  const confirmEndActivity = async () => {
    setShowEndConfirm(false);
    if (activity?.id) {
      await endCrewActivity(activity.id);
    }
    if (onEndActivity) onEndActivity();
    else onClose();
  };

  const rawParticipants = useMemo(() => {
    if (activity) {
      if (Array.isArray(activity._membersData) && activity._membersData.length > 0) return activity._membersData;
      if (Array.isArray(activity.members) && activity.members.length > 0) return activity.members.map(m => m.user || { id: m.userId });
      if (Array.isArray(activity.participants) && activity.participants.length > 0) return activity.participants;
    }
    return conversation?.participants || conversation?.members || [];
  }, [activity, conversation]);

  const sortedParticipants = useMemo(() => {
    return sortGroupMembers(rawParticipants, {
      hostId: activity?.hostId || activity?.creatorId,
      users
    });
  }, [rawParticipants, activity?.hostId, activity?.creatorId, users]);

  const participantList = useMemo(() => {
    return sortedParticipants.map(p => {
      if (typeof p === 'object' && p !== null) return p;
      return users[p] || Object.values(users).find(u => u.id === p) || { id: p };
    });
  }, [sortedParticipants, users]);

  return (
    <>
      <div className={styles.overlay} onClick={onClose}>
        <div className={styles.modal} onClick={e => e.stopPropagation()}>
          <div className={styles.header}>
            <h2 className={styles.title}>{activity.title || conversation.name || 'Activity Details'}</h2>
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
                {(() => {
                  const status = (activity?.status || conversation?.status || '').toUpperCase();
                  const hasStarted = status === 'IN_PROGRESS' || status === 'STARTED' || status === 'COMPLETED' || status === 'ENDED' || conversation?.hasStarted || conversation?.activityHasStarted || (activity.date ? (new Date(activity.date) <= new Date()) : false);
                  return (
                    <div className={styles.detailItem} style={{ gap: '0.75rem', alignItems: 'center' }}>
                      {hasStarted ? (
                        <div className={sidebarStyles.startedCalendarBadge}>
                          <CalendarDays size={28} />
                        </div>
                      ) : (
                        <CalendarIcon date={activity.date} dateLabel={activity.dateLabel} />
                      )}
                      <div className={styles.detailText} style={{ fontWeight: '600' }}>{activity.dateLabel || (activity.date ? new Date(activity.date).toLocaleDateString() : '')}</div>
                    </div>
                  );
                })()}
                {activity.time && (
                  <div className={styles.detailItem}>
                    <svg className={styles.detailIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    <div className={styles.detailText}>{activity.time}</div>
                  </div>
                )}
                {activity.location && (
                  <div className={styles.detailItem}>
                    <svg className={styles.detailIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    <div className={styles.detailText}>{activity.location}</div>
                  </div>
                )}
                {activity.description && (
                  <div className={styles.detailItem} style={{ alignItems: 'flex-start' }}>
                    <svg className={styles.detailIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: '3px' }}>
                      <line x1="4" y1="6" x2="20" y2="6" />
                      <line x1="4" y1="12" x2="20" y2="12" />
                      <line x1="4" y1="18" x2="12" y2="18" />
                    </svg>
                    <div className={styles.detailText} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                      {activity.description}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Members ({participantList.length})</h3>
              <div className={styles.membersList}>
                {participantList.map((userObj, idx) => {
                  if (!userObj) return null;
                  const uId = userObj.id || userObj.userId || idx;
                  const isActivityHost = uId === (activity.hostId || activity.creatorId);
                  
                  return (
                    <div key={uId} className={styles.memberItem}>
                      <Link to={`/profile/${userObj.username || uId}`} className={styles.memberLink}>
                        {userObj.avatar && isImageUrl(userObj.avatar) ? (
                          <img src={userObj.avatar} alt="" className={styles.avatarImg} />
                        ) : (
                          <DefaultAvatar size={38} />
                        )}
                        <div className={styles.memberMeta}>
                          <span className={styles.memberName}>{userObj.displayName || userObj.name || userObj.username || 'Member'}</span>
                          {userObj.username && <span className={styles.memberUsername}>@{userObj.username}</span>}
                        </div>
                      </Link>

                      <div className={styles.memberRight}>
                        {isActivityHost && <span className={styles.roleTag}>Host</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {isHost && (
              <div className={styles.actions}>
                {(() => {
                  const status = (activity?.status || conversation?.status || '').toUpperCase();
                  const hasStarted = status === 'IN_PROGRESS' || status === 'STARTED' || status === 'COMPLETED' || status === 'ENDED' || conversation?.hasStarted || conversation?.activityHasStarted || (activity.date ? (new Date(activity.date) <= new Date()) : false);
                  return (
                    <button className={styles.endBtn} onClick={handleEndActivity}>
                      {hasStarted ? 'End Group' : 'End Activity'}
                    </button>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmModal
        visible={showEndConfirm}
        title={(() => {
          const status = (activity?.status || conversation?.status || '').toUpperCase();
          const hasStarted = status === 'IN_PROGRESS' || status === 'STARTED' || status === 'COMPLETED' || status === 'ENDED' || conversation?.hasStarted || conversation?.activityHasStarted || (activity.date ? (new Date(activity.date) <= new Date()) : false);
          return hasStarted ? "End Group" : "End Activity";
        })()}
        desc={(() => {
          const status = (activity?.status || conversation?.status || '').toUpperCase();
          const hasStarted = status === 'IN_PROGRESS' || status === 'STARTED' || status === 'COMPLETED' || status === 'ENDED' || conversation?.hasStarted || conversation?.activityHasStarted || (activity.date ? (new Date(activity.date) <= new Date()) : false);
          return hasStarted ? "This group will be closed permanently. Previous chats and media will remain accessible." : "Are you sure you want to end this activity? This will remove all members and delete the group.";
        })()}
        onConfirm={confirmEndActivity}
        onCancel={() => setShowEndConfirm(false)}
        confirmText={(() => {
          const status = (activity?.status || conversation?.status || '').toUpperCase();
          const hasStarted = status === 'IN_PROGRESS' || status === 'STARTED' || status === 'COMPLETED' || status === 'ENDED' || conversation?.hasStarted || conversation?.activityHasStarted || (activity.date ? (new Date(activity.date) <= new Date()) : false);
          return hasStarted ? "End Group" : "End Activity";
        })()}
      />
    </>
  );
}
