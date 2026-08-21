import { useState, useRef, useMemo } from 'react';
import { useAuth } from '@shared/context/AuthContext';
import { useUsersMap } from '@shared/hooks/useUsersMap';
import { useGroupActions } from '@shared/hooks/useGroupActions';
import { processAndUploadImage } from '@shared/utils/mediaPipeline';
import Avatar from '@shared/components/avatar/Avatar';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import { sortGroupMembers } from '@shared/utils/memberSort';
import { showToast } from '@shared/utils/toast';
import styles from './GroupSettingsModal.module.css';

export default function GroupSettingsModal({ conversation, onClose, onLeaveGroup }) {
  const { currentUser } = useAuth();
  const users = useUsersMap();
  const { updateGroupInfo, removeGroupMember } = useGroupActions();
  const [editName, setEditName] = useState(conversation.name || '');
  const [editDesc, setEditDesc] = useState(conversation.description || '');

  const [confirmModal, setConfirmModal] = useState({ visible: false, targetUserId: null });

  const isOwner = currentUser?.id === conversation.ownerId || currentUser?.id === conversation.hostId;
  const isAdmin = isOwner || (conversation.admins || []).includes(currentUser?.id);
  // Groups carry their hydrated roster on `memberDetails`: GET /group-chats/:id
  // returns it populated while `members` comes back empty, so reading `members`
  // first showed "MEMBERS (0)" on a group whose header said 2 members. Prefer the
  // first array that actually has entries, which keeps the old behaviour wherever
  // `members` is populated. ChatDetailsPanel already sources groups this way.
  const rawParticipants = (
    conversation.memberDetails?.length ? conversation.memberDetails
      : conversation.members?.length ? conversation.members
        : conversation.participants
  ) || [];
  const sortedParticipants = useMemo(() => {
    return sortGroupMembers(rawParticipants, {
      ownerId: conversation.ownerId,
      hostId: conversation.hostId,
      admins: conversation.admins,
      users
    });
  }, [rawParticipants, conversation.ownerId, conversation.hostId, conversation.admins, users]);
  const memberIds = sortedParticipants.map(p => p?.userId || p?.id || (typeof p === 'string' ? p : ''));


  const formattedDate = conversation.createdAt 
    ? new Date(conversation.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : 'Unknown date';

  const handleSaveInfo = async () => {
    const trimmedName = editName.trim();
    if (trimmedName) {
      const nameChanged = trimmedName !== conversation.name;
      const descChanged = editDesc.trim() !== (conversation.description || '');

      if (nameChanged || descChanged) {
        await updateGroupInfo(
          conversation.id,
          nameChanged ? trimmedName : undefined,
          undefined, // avatar is handled separately
          descChanged ? editDesc.trim() : undefined
        );
      }
    }
  };

  const fileInputRef = useRef(null);

  const handleAvatarClick = () => {
    if (!isAdmin) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const MAX_FILE_SIZE = 50 * 1024 * 1024;
      if (file.size > MAX_FILE_SIZE) {
        showToast('File size limit is 50 MB', 'error');
        e.target.value = '';
        return;
      }
      const originalAvatar = conversation.avatarKey || conversation.avatar || '';
      const tempUrl = URL.createObjectURL(file);
      
      // Optimistic update
      updateGroupInfo(conversation.id, undefined, tempUrl, undefined, originalAvatar);
      
      // Background upload
      (async () => {
        try {
          const { publicUrl } = await processAndUploadImage(file, 'avatars', { maxWidthOrHeight: 512 });
          await updateGroupInfo(conversation.id, undefined, publicUrl, undefined, originalAvatar);
        } catch {
          showToast('Icon upload failed', 'error');
          updateGroupInfo(conversation.id, undefined, originalAvatar, undefined);
        }
      })();
    }
    // Clear input so same file can be selected again
    e.target.value = '';
  };

  const openRemoveConfirm = (userId) => {
    setConfirmModal({ visible: true, targetUserId: userId });
  };

  const confirmRemoveMember = () => {
    if (confirmModal.targetUserId) {
      removeGroupMember(conversation.id, confirmModal.targetUserId);
    }
    setConfirmModal({ visible: false, targetUserId: null });
  };

  return (
    <>
      <input 
        type="file" 
        accept="image/*" 
        ref={fileInputRef} 
        style={{ display: 'none' }} 
        onChange={handleFileChange} 
      />
      <div className={styles.overlay} onClick={onClose}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div className={styles.header}>
            <h3 className={styles.title}>Group Details</h3>
            <button onClick={onClose} className={styles.closeBtn}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className={styles.body}>
            <div className={styles.avatarSection}>
              <Avatar
                src={conversation.avatarKey || conversation.avatar || conversation.icon || conversation.coverImage}
                name={conversation.name}
                size="100px"
                isGroup={true}
                onClick={handleAvatarClick}
                className={styles.largeAvatarWrapper}
              >
                {isAdmin && (
                  <div className={styles.avatarOverlay}>
                    Change
                  </div>
                )}
              </Avatar>
              <div className={styles.dateCreated}>Created on {formattedDate}</div>
            </div>

            {isAdmin ? (
              <>
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Group Name</div>
                  <div className={styles.inputRow}>
                    <input
                      type="text"
                      className={styles.groupInput}
                      value={editName}
                      maxLength={120}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>
                </div>
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Description</div>
                  <textarea
                    className={styles.descTextArea}
                    value={editDesc}
                    maxLength={300}
                    onChange={(e) => setEditDesc(e.target.value)}
                    placeholder="Add a group description..."
                  />
                  <button
                    className={styles.saveBtn}
                    onClick={handleSaveInfo}
                    style={{ padding: '0.75rem', marginTop: '0.5rem' }}
                    disabled={editName === conversation.name && editDesc === (conversation.description || '')}
                  >
                    Save Changes
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Group Name</div>
                  <div className={styles.descText}>{conversation.name}</div>
                </div>
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Description</div>
                  <div className={styles.descText}>
                    {conversation.description || <span style={{ color: 'var(--color-text-muted)' }}>No description provided.</span>}
                  </div>
                </div>
              </>
            )}

            <div className={styles.section}>
              <div className={styles.sectionTitle}>Members ({memberIds.length})</div>
              <div className={styles.memberList}>
                {memberIds.map(uid => {
                  const isUserOwner = uid === conversation.ownerId || uid === conversation.hostId;
                  const isUserAdmin = (conversation.admins || []).includes(uid);
                  const isMe = uid === currentUser?.id;
                  
                  const userObj = Object.values(users).find(u => u.id === uid) || { 
                    id: uid, 
                    name: isMe ? currentUser?.name || 'You' : 'Unknown User', 
                    username: isMe ? currentUser?.username || 'you' : 'unknown'
                  };

                  return (
                    <div key={uid} className={styles.memberItem}>
                      <Avatar 
                        src={userObj.avatar} 
                        name={userObj.name} 
                        size="40px" 
                      />
                      <div className={styles.memberInfo}>
                        <div className={styles.memberName}>
                          {userObj.displayName || userObj.name} {isMe && '(You)'}
                        </div>
                        <div className={styles.memberRole}>
                          {isUserOwner && <span className={styles.roleTag}>Owner</span>}
                          {isUserAdmin && !isUserOwner && <span className={styles.roleTag} style={{ background: 'rgba(99, 102, 241, 0.1)', color: '#6366f1' }}>Admin</span>}
                          {!isUserOwner && !isUserAdmin && 'Member'}
                        </div>
                      </div>
                      {isAdmin && !isMe && !isUserOwner && (isOwner || !isUserAdmin) && (
                        <button className={styles.actionBtn} onClick={() => openRemoveConfirm(uid)}>
                          Remove
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <button className={styles.leaveBtn} onClick={onLeaveGroup}>
              Leave Group
            </button>
          </div>
        </div>
      </div>

      <ConfirmModal
        title="Remove Member"
        desc="This member will be removed from the group."
        visible={confirmModal.visible}
        onCancel={() => setConfirmModal({ visible: false, targetUserId: null })}
        onConfirm={confirmRemoveMember}
        confirmText="Remove"
        cancelText="Cancel"
        isDestructive={true}
      />
    </>
  );
}
