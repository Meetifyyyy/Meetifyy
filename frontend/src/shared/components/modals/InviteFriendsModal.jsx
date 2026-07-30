import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usersApi, activitiesApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import ShareModalAvatar from '../avatar/ShareModalAvatar';
import styles from './InviteFriendsModal.module.css';
import { Search, X, Check, UserCheck, Clock, AlertCircle } from 'lucide-react';

export default function InviteFriendsModal({
  activityId,
  initialSelectedIds = [],
  onSelectUsers,
  onSendInvites,
  onClose,
}) {
  const { currentUser } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState(initialSelectedIds);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useOverlayBack(true, onClose, { pushHistoryState: false });

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Fetch user's following list (friends)
  const { data: friendsList = [], isLoading: isLoadingFriends } = useQuery({
    queryKey: ['user-following-friends', currentUser?.username],
    queryFn: () => usersApi.getFollowing(currentUser?.username, 100, 0),
    enabled: !!currentUser?.username,
    staleTime: 30_000,
  });

  // Fetch invitation statuses for existing activity if activityId is provided
  const { data: invStatuses = {} } = useQuery({
    queryKey: ['activity-invitation-statuses', activityId],
    queryFn: () => activitiesApi.getInvitationStatuses(activityId),
    enabled: !!activityId,
    staleTime: 10_000,
  });

  const filteredFriends = useMemo(() => {
    if (!Array.isArray(friendsList)) return [];
    if (!searchQuery.trim()) return friendsList;
    const q = searchQuery.toLowerCase().trim();
    return friendsList.filter(
      (u) =>
        u.displayName?.toLowerCase().includes(q) ||
        u.username?.toLowerCase().includes(q)
    );
  }, [friendsList, searchQuery]);

  const toggleSelect = (userId, disabled) => {
    if (disabled) return;
    setSelectedIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  };

  const handleDone = async () => {
    if (selectedIds.length === 0) return;
    setIsSubmitting(true);
    try {
      if (activityId && onSendInvites) {
        await onSendInvites(selectedIds);
      } else if (onSelectUsers) {
        onSelectUsers(selectedIds, filteredFriends.filter(f => selectedIds.includes(f.id)));
      }
      onClose();
    } catch (err) {
      console.error('Failed to invite friends', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <h3 className={styles.title}>Invite Friends</h3>
            <span className={styles.subtitle}>Select friends to invite to this activity</span>
          </div>
          <button onClick={onClose} className={styles.closeBtn} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        <div className={styles.searchWrap}>
          <div className={styles.searchBox}>
            <Search size={16} className={styles.searchIcon} />
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search friends..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div className={styles.body}>
          {isLoadingFriends ? (
            <div className={styles.emptyState}>Loading friends...</div>
          ) : filteredFriends.length === 0 ? (
            <div className={styles.emptyState}>
              {searchQuery ? 'No friends match your search.' : 'You are not following any friends yet.'}
            </div>
          ) : (
            filteredFriends.map((friend) => {
              const userId = friend.id;
              const userStatusInfo = invStatuses[userId] || (typeof invStatuses[userId] === 'string' ? { status: invStatuses[userId] } : null);
              const status = userStatusInfo?.status;

              let isMember = status === 'MEMBER';
              let isPending = status === 'PENDING';
              let isCooldown = status === 'COOLDOWN';
              let cooldownMins = userStatusInfo?.remainingMins;

              const isDisabled = isMember || isPending || isCooldown;
              const isSelected = selectedIds.includes(userId);

              return (
                <div
                  key={userId}
                  className={`${styles.userRow} ${isDisabled ? styles.disabled : ''} ${
                    isSelected ? styles.selected : ''
                  }`}
                  onClick={() => toggleSelect(userId, isDisabled)}
                >
                  <div className={styles.userInfo}>
                    <div className={styles.userAvatar}>
                      <ShareModalAvatar
                        conv={friend}
                        size="48px"
                      />
                    </div>
                    <div className={styles.userDetails}>
                      <span className={styles.userName}>{friend.displayName || friend.username}</span>
                      <span className={styles.userUsername}>@{friend.username}</span>
                    </div>
                  </div>

                  {isMember ? (
                    <span className={`${styles.statusBadge} ${styles.badgeMember}`}>Joined</span>
                  ) : isPending ? (
                    <span className={`${styles.statusBadge} ${styles.badgePending}`}>Invited</span>
                  ) : isCooldown ? (
                    <span className={`${styles.statusBadge} ${styles.badgeCooldown}`}>
                      Declined ({cooldownMins || 240}m)
                    </span>
                  ) : (
                    <div className={`${styles.checkbox} ${isSelected ? styles.checked : ''}`}>
                      {isSelected && <Check size={14} />}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className={styles.footer}>
          <span className={styles.selectedCount}>
            {selectedIds.length} {selectedIds.length === 1 ? 'friend' : 'friends'} selected
          </span>
          <button
            className={styles.sendBtn}
            onClick={handleDone}
            disabled={selectedIds.length === 0 || isSubmitting}
          >
            {isSubmitting ? 'Sending...' : 'Send Invitations'}
          </button>
        </div>
      </div>
    </div>
  );
}
