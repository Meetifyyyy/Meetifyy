import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { UserX, Ban, Flag, ShieldPlus, ShieldMinus } from 'lucide-react';
import { isImageUrl } from "@shared/utils/avatar";
import DefaultAvatar from '@shared/components/avatar/DefaultAvatar';
import { CollegeRepresentativeBadge } from '@shared/components/badges/CollegeRepresentativeBadge';
import styles from './CommunityMembersModal.module.css';
import { useUsersMap } from '@shared/hooks/useUsersMap';
import { useAuth } from '@shared/context/AuthContext';
import { usersApi, communitiesApi, getMediaUrl } from '@shared/api/apiClient';
import { showToast } from '@shared/utils/toast';
import ReportModal from '@shared/components/modals/ReportModal/ReportModal';
import { sortGroupMembers } from '@shared/utils/memberSort';
import { useCommunityActions } from '@shared/hooks/useCommunityActions';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import PromoteModeratorModal from '../moderation/PromoteModeratorModal';


/**
 * Per-member action menu (⋯ button)
 * Props:
 *   member        — the member object
 *   communityId   — community ID for remove-member
 *   isCurrentUser — hide actions on own row
 *   isAdmin       — show Remove option (owner or moderator)
 *   isOwner       — show promote/demote (owner only, mirroring the server)
 *   isTargetOwner — the community owner's own row: never actionable
 *   isTargetMod   — drives promote vs demote
 *   onRemoved     — callback after removing member
 *   onRoleChanged — callback after a promote/demote
 */
function MemberActionMenu({
  member, communityId, isCurrentUser, isAdmin, isOwner,
  isTargetOwner, isTargetMod, onRemoved, onRoleChanged,
}) {
  const [open, setOpen] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [hasReported, setHasReported] = useState(false);
  const [coords, setCoords] = useState(null);
  const [roleBusy, setRoleBusy] = useState(false);
  // Promotion is gated behind an explicit confirmation that spells out the
  // powers being granted; nothing changes until it is confirmed.
  const [confirmPromote, setConfirmPromote] = useState(false);
  const btnRef = useRef(null);

  const toggleOpen = (e) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const vh = window.visualViewport?.height || window.innerHeight;
      const spaceBelow = vh - rect.bottom;
      const openUp = spaceBelow < 180;

      setCoords({
        right: window.innerWidth - rect.right,
        top: openUp ? 'auto' : rect.bottom + 4,
        bottom: openUp ? vh - rect.top + 4 : 'auto'
      });
    }
    setOpen(!open);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      const menuEl = document.getElementById(`member-menu-${member.id}`);
      if (menuEl && menuEl.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    window.visualViewport?.addEventListener('resize', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.visualViewport?.removeEventListener('resize', handler);
    };
  }, [open, member.id]);

  if (isCurrentUser) return null;

  const handleBlock = async () => {
    setOpen(false);
    try {
      await usersApi.blockUser(member.id);
      showToast(`${member.name} blocked`, 'success');
      // Drop them from the open list straight away. The backend now filters
      // blocked members out of this list, so leaving the row on screen until
      // the next refetch shows a member the server no longer returns.
      if (onRemoved) onRemoved(member.id);
    } catch {
      showToast("Couldn't block user", 'error');
    }
  };

  const handleRemove = async () => {
    setOpen(false);
    try {
      await communitiesApi.removeGroupMember(communityId, member.id);
      showToast(`${member.name} removed`, 'success');
      if (onRemoved) onRemoved(member.id);
    } catch (err) {
      showToast(err?.message || "Couldn't remove member", 'error');
    }
  };

  /**
   * Promotion asks first; demotion does not.
   *
   * Granting moderator powers is the consequential direction — it hands
   * someone authority over other members' content and membership, from a menu
   * one item away from "Remove member". Taking it back is recoverable and
   * needs no ceremony.
   */
  const handleRoleToggle = async () => {
    if (roleBusy) return;
    if (!isTargetMod) {
      setOpen(false);
      setConfirmPromote(true);
      return;
    }
    await applyRoleChange('MEMBER');
  };

  const applyRoleChange = async (nextRole) => {
    if (roleBusy) return;
    setRoleBusy(true);
    try {
      // The cache patch lives in the caller so the member strip behind this
      // modal updates too, not just the row under the cursor.
      const ok = await onRoleChanged?.(member.id, nextRole);
      if (ok !== false) {
        showToast(
          nextRole === 'MODERATOR'
            ? `${member.name} is now a moderator`
            : `${member.name} is no longer a moderator`,
          'success',
        );
        setOpen(false);
      }
    } finally {
      setRoleBusy(false);
    }
  };

  const confirmPromotion = async () => {
    await applyRoleChange('MODERATOR');
    setConfirmPromote(false);
  };

  const promoteModal = confirmPromote ? (
    <PromoteModeratorModal
      memberName={member.name}
      isBusy={roleBusy}
      onConfirm={confirmPromotion}
      onCancel={() => setConfirmPromote(false)}
    />
  ) : null;

  return (
    <div style={{ flexShrink: 0 }}>
      {promoteModal}
      <button
        ref={btnRef}
        onClick={toggleOpen}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.3rem 0.4rem', borderRadius: '6px', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center' }}
        title="Actions"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
      </button>

      {open && coords && createPortal(
        <div
          id={`member-menu-${member.id}`}
          style={{
            position: 'fixed',
            right: `${coords.right}px`,
            top: coords.top !== 'auto' ? `${coords.top}px` : 'auto',
            bottom: coords.bottom !== 'auto' ? `${coords.bottom}px` : 'auto',
            background: 'var(--color-bg-white)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg, 12px)',
            boxShadow: 'var(--shadow-lg, 0 10px 25px rgba(0, 0, 0, 0.15))',
            zIndex: 100000,
            width: '180px',
            padding: '0.35rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.15rem',
            overflow: 'hidden'
          }}
        >
          {/* Promote / demote. Owner-only, matching the server rule that
              "only the community owner can manage member roles" — showing it
              to moderators would only produce a 403. The owner's own row is
              never actionable: the server refuses to re-role them. */}
          {isOwner && !isTargetOwner && (
            <button
              onClick={handleRoleToggle}
              disabled={roleBusy}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-bg-soft)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '0.6rem 0.75rem',
                background: 'transparent',
                border: 'none',
                cursor: roleBusy ? 'default' : 'pointer',
                fontSize: '0.85rem',
                color: 'var(--color-text-main)',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                borderRadius: 'var(--radius-md, 8px)',
                transition: 'background 0.15s ease',
                opacity: roleBusy ? 0.6 : 1,
              }}
            >
              {isTargetMod
                ? <ShieldMinus size={16} color="var(--color-text-muted)" />
                : <ShieldPlus size={16} color="var(--color-text-muted)" />}
              <span>
                {roleBusy
                  ? 'Saving…'
                  : isTargetMod ? 'Remove as moderator' : 'Make moderator'}
              </span>
            </button>
          )}

          {isAdmin && !isTargetOwner && (
            <button 
              onClick={handleRemove} 
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-bg-soft)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              style={{ 
                width: '100%', 
                textAlign: 'left', 
                padding: '0.6rem 0.75rem', 
                background: 'transparent', 
                border: 'none', 
                cursor: 'pointer', 
                fontSize: '0.85rem', 
                color: 'var(--color-danger, #ef4444)', 
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                borderRadius: 'var(--radius-md, 8px)',
                transition: 'background 0.15s ease'
              }}
            >
              <UserX size={16} color="var(--color-danger, #ef4444)" />
              <span>Remove</span>
            </button>
          )}
          <button 
            onClick={handleBlock} 
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-bg-soft)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            style={{ 
              width: '100%', 
              textAlign: 'left', 
              padding: '0.6rem 0.75rem', 
              background: 'transparent', 
              border: 'none', 
              cursor: 'pointer', 
              fontSize: '0.85rem', 
              color: 'var(--color-text-main)', 
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              borderRadius: 'var(--radius-md, 8px)',
              transition: 'background 0.15s ease'
            }}
          >
            <Ban size={16} color="var(--color-text-muted)" />
            <span>Block</span>
          </button>
          <button
            onClick={() => { setOpen(false); if (!hasReported) setShowReportModal(true); }}
            disabled={hasReported}
            onMouseEnter={(e) => !hasReported && (e.currentTarget.style.background = 'var(--color-bg-soft)')}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            style={{ 
              width: '100%', 
              textAlign: 'left', 
              padding: '0.6rem 0.75rem', 
              background: 'transparent', 
              border: 'none', 
              cursor: hasReported ? 'default' : 'pointer', 
              fontSize: '0.85rem', 
              color: hasReported ? 'var(--color-text-muted)' : 'var(--color-text-main)', 
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              borderRadius: 'var(--radius-md, 8px)',
              transition: 'background 0.15s ease'
            }}
          >
            <Flag size={16} color="var(--color-text-muted)" />
            <span>{hasReported ? 'Reported' : 'Report'}</span>
          </button>
        </div>,
        document.body
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

export default function CommunityMembersModal({
  members: initialMembers, title, onClose, communityId, isAdmin, isOwner: viewerIsOwner, ownerId,
}) {
  const navigate = useNavigate();
  const users = useUsersMap();
  const { currentUser } = useAuth();
  const [members, setMembers] = useState(initialMembers || []);

  // Back dismisses this dialog rather than navigating the page behind it.
  useOverlayBack(true, onClose);

  useEffect(() => {
    if (initialMembers) setMembers(initialMembers);
  }, [initialMembers]);

  const sortedMembers = useMemo(() => {
    return sortGroupMembers(members, { ownerId, users });
  }, [members, ownerId, users]);

  const handleNameClick = (e, memberName) => {
    e.stopPropagation();
    const matchedUser = Object.values(users).find(u => u.displayName === memberName);
    if (matchedUser) {
      navigate(`/profile/${matchedUser.username}`);
      onClose();
    }
  };

  const { setMemberRole } = useCommunityActions();

  const handleMemberRemoved = (removedId) => {
    setMembers(prev => prev.filter(m => m.id !== removedId));
  };

  /**
   * Promote or demote, then reflect it in this modal's own copy of the list.
   *
   * `setMemberRole` patches the shared query cache — which is what updates
   * the member strip on the page behind — but this modal keeps a local list
   * so it can filter and sort, and that copy has to be told separately.
   */
  const handleRoleChanged = async (memberId, role) => {
    const ok = await setMemberRole(communityId, memberId, role, currentUser?.id);
    if (ok) {
      setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, role } : m)));
    }
    return ok;
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
          {!sortedMembers || sortedMembers.length === 0 ? (
            <div className={styles.empty}>
              No members found.
            </div>
          ) : (
            sortedMembers.map((member, i) => {

              const matchedUser =
                (member.id && Object.values(users).find(u => u.id === member.id)) ||
                (member.username && Object.values(users).find(u => u.username === member.username)) ||
                Object.values(users).find(u => u.displayName === member.name);
              const username = member.username || matchedUser?.username;
              const isSelf = currentUser?.id === member.id || currentUser?.username === username;

              const roleUpper = String(member.role || '').toUpperCase();
              const isOwner = member.admin || roleUpper === 'OWNER' || roleUpper === 'CREATOR' || (ownerId && String(member.id) === String(ownerId));
              const isMod = roleUpper === 'MODERATOR';

              return (
                <div key={i} className={styles.userItem}>
                  <div className={styles.userAvatar}>
                    {isImageUrl(member.avatar || matchedUser?.avatar) ? (
                      <img src={getMediaUrl(member.avatar || matchedUser?.avatar)} alt="avatar" className={styles.avatarImg} onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.webp'; }} />
                    ) : (
                      <DefaultAvatar style={{ width: '100%', height: '100%' }} />
                    )}
                  </div>
                  <div className={styles.userInfo}>
                    <div className={styles.userNameRow}>
                      <span className={styles.userName} onClick={(e) => handleNameClick(e, member.name)}>
                        {member.name}
                      </span>
                      <CollegeRepresentativeBadge isCampusRep={matchedUser?.isCampusRep || member?.isCampusRep} user={matchedUser || member} size="sm" />
                      {isOwner ? (
                        <span className={styles.userBadge} style={{ background: 'rgba(236, 72, 153, 0.1)', color: '#EC4899' }}>
                          Owner
                        </span>
                      ) : isMod ? (
                        <span className={styles.userBadge} style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3B82F6' }}>
                          Moderator
                        </span>
                      ) : null}
                    </div>
                    {username && (
                      <div className={styles.userUsername}>@{username}</div>
                    )}
                    {(member.branch || member.year) && (
                      <div className={styles.userRole}>
                        {[member.branch, member.year].filter(Boolean).join(' • ')}
                      </div>
                    )}
                  </div>
                  <MemberActionMenu
                    member={member}
                    communityId={communityId}
                    isCurrentUser={isSelf}
                    isAdmin={isAdmin}
                    isOwner={Boolean(viewerIsOwner)}
                    isTargetOwner={isOwner}
                    isTargetMod={isMod}
                    onRoleChanged={handleRoleChanged}
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
