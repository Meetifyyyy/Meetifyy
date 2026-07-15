import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useData } from '@shared/context/DataContext';
import { isImageUrl } from '@shared/utils/avatar';
import DefaultAvatar from '@shared/components/avatar/DefaultAvatar';
import styles from './CommunityMembersModal.module.css';

export default function CommunityMembersModal({ members, title, onClose }) {
  const navigate = useNavigate();
  const { users } = useData();

  const handleNameClick = (e, memberName) => {
    e.stopPropagation();
    const matchedUser = Object.values(users).find(u => u.displayName === memberName);
    if (matchedUser) {
      navigate(`/profile/${matchedUser.username}`);
      onClose();
    }
  };

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3 className={styles.title}>{title || 'Members'}</h3>
          <button onClick={onClose} className={styles.closeBtn}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          {!members || members.length === 0 ? (
            <div className={styles.empty}>
              No members found.
            </div>
          ) : (
            members.map((member, i) => {
              const matchedUser =
                (member.id && Object.values(users).find(u => u.id === member.id)) ||
                (member.username && Object.values(users).find(u => u.username === member.username)) ||
                Object.values(users).find(u => u.displayName === member.name);
              const username = member.username || matchedUser?.username;
              return (
                <div key={i} className={styles.userItem}>
                  <div className={styles.userAvatar}>
                    {isImageUrl(member.avatar) ? (
                      <img src={member.avatar} alt="avatar" className={styles.avatarImg} />
                    ) : (
                      <DefaultAvatar style={{ width: '100%', height: '100%' }} />
                    )}
                  </div>
                  <div className={styles.userInfo}>
                    <div className={styles.userName} onClick={(e) => handleNameClick(e, member.name)}>
                      {member.name}
                      {member.admin && (
                        <span className={styles.userBadge} style={{ background: 'rgba(236, 72, 153, 0.1)', color: '#EC4899' }}>
                          Owner
                        </span>
                      )}
                    </div>
                    {username && (
                      <div className={styles.userUsername}>@{username}</div>
                    )}
                    <div className={styles.userRole}>
                      {(!member.role || member.role === 'Creator') ? '' : member.role}
                      {member.branch ? ` • ${member.branch}` : ''}
                      {member.year ? ` • ${member.year}` : ''}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
