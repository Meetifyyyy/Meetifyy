import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';

import { isImageUrl } from '@shared/utils/avatar';
import DefaultAvatar from '@shared/components/avatar/DefaultAvatar';
import styles from './CommunityMembersModal.module.css';
import { useData } from '@shared/hooks/useData';
import { usersApi, communitiesApi } from '@shared/api/apiClient';
import { showToast } from '@shared/utils/toast';
import ReportModal from '@shared/components/modals/ReportModal/ReportModal';

/**
 * Per-member action menu (⋯ button)
 * Props:
 *   member        — the member object
 *   communityId   — community ID for remove-member
 *   isCurrentUser — hide actions on own row
 *   isAdmin       — show Remove option
 *   onRemoved     — callback after removing member
 */
function MemberActionMenu({ member, communityId, isCurrentUser, isAdmin, onRemoved }) {
  const [open, setOpen] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [hasReported, setHasReported] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (isCurrentUser) return null;

  const handleBlock = async () => {
    setOpen(false);
    try {
      await usersApi.blockUser(member.id);
      showToast(`${member.name} blocked.`);
    } catch {
      showToast('Could not block user.');
    }
  };

  const handleRemove = async () => {
    setOpen(false);
    try {
      await communitiesApi.removeGroupMember(communityId, member.id);
      showToast(`${member.name} removed.`);
      if (onRemoved) onRemoved(member.id);
    } catch {
      showToast('Could not remove member.');
    }
  };

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.3rem 0.4rem', borderRadius: '6px', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center' }}
        title="Actions"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
      </button>

      {open && (
        <div style={{ position: 'absolute', right: 0, top: '100%', background: 'var(--color-bg-white)', border: '1px solid var(--color-border)', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100, minWidth: '160px', overflow: 'hidden' }}>
          {isAdmin && (
            <button onClick={handleRemove} style={{ width: '100%', textAlign: 'left', padding: '0.7rem 1rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem', color: 'var(--color-danger, #ef4444)', fontWeight: 500 }}>
              Remove from community
            </button>
          )}
          <button onClick={handleBlock} style={{ width: '100%', textAlign: 'left', padding: '0.7rem 1rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem', color: 'var(--color-text-main)', fontWeight: 500 }}>
            Block
          </button>
          <button
            onClick={() => { setOpen(false); if (!hasReported) setShowReportModal(true); }}
            disabled={hasReported}
            style={{ width: '100%', textAlign: 'left', padding: '0.7rem 1rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem', color: hasReported ? 'var(--color-text-muted)' : 'var(--color-text-main)', fontWeight: 500 }}
          >
            {hasReported ? 'Already Reported' : 'Report'}
          </button>
        </div>
      )}

      <ReportModal
        isOpen={showReportModal}
        onClose={() => setShowReportModal(false)}
        targetType="USER"
        targetId={member.id}
        targetName={member.name || member.username}
        targetAvatar={member.avatar}
        reportedFrom="community-members"
        onSubmitted={() => setHasReported(true)}
      />
    </div>
  );
}

export default function CommunityMembersModal({ members: initialMembers, title, onClose, communityId, isAdmin }) {
  const navigate = useNavigate();
  const { users, currentUser } = useData();
  const [members, setMembers] = useState(initialMembers || []);

  const handleNameClick = (e, memberName) => {
    e.stopPropagation();
    const matchedUser = Object.values(users).find(u => u.displayName === memberName);
    if (matchedUser) {
      navigate(`/profile/${matchedUser.username}`);
      onClose();
    }
  };

  const handleMemberRemoved = (removedId) => {
    setMembers(prev => prev.filter(m => m.id !== removedId));
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
              const isSelf = currentUser?.id === member.id || currentUser?.username === username;
              return (
                <div key={i} className={styles.userItem} style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
                  <div className={styles.userAvatar}>
                    {isImageUrl(member.avatar) ? (
                      <img src={member.avatar} alt="avatar" className={styles.avatarImg}  onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.png'; }} />
                    ) : (
                      <DefaultAvatar style={{ width: '100%', height: '100%' }} />
                    )}
                  </div>
                  <div className={styles.userInfo} style={{ flex: 1, minWidth: 0 }}>
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
                  <MemberActionMenu
                    member={member}
                    communityId={communityId}
                    isCurrentUser={isSelf}
                    isAdmin={isAdmin}
                    onRemoved={handleMemberRemoved}
                  />
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
