import { ArrowLeft, MoreVertical, Search, NotificationOff, NotificationOn, LogOut, Info, Trash2, Pin } from '@shared/components/icons';
import Menu, { MenuItem, useMenu } from '@shared/components/ui/Menu';
import { useAuth } from '@shared/context/AuthContext';
import Avatar from '@shared/components/avatar/Avatar';
import styles from '../../../shared/components/chat/ChatHeader.module.css';

export default function GroupChatHeader({ 
  conversation, 
  onBack, 
  onLeaveGroup, 
  onEndGroup,
  onClearChat, 
  onTogglePin,
  onToggleMute,
  onToggleSearch, 
  onOpenDetails,
  isAdmin,
}) {
  const { currentUser } = useAuth();
  /*
   * Outside click, Escape and hardware Back all dismiss this menu, and Back
   * dismisses only the menu rather than the chat underneath it — all of which
   * `Menu` now provides, so the feature-local `useDismissibleMenu` hook this
   * used is no longer needed here.
   */
  const moreMenu = useMenu();

  if (!conversation) return null;

  // Muted state comes from the shared conversation cache, never from local
  // component state. The button used to flip a `useState` and nothing else:
  // the label toggled, no request was ever sent, and the state was lost on
  // remount — the chat was never actually muted. Reading the cache means this
  // button, the sidebar context menu and the notification suppression all
  // observe one value, and the optimistic write updates all three at once.
  const isMuted = Boolean(conversation.muted ?? conversation.isMuted);

  // Ownership only — deliberately NOT `isAdmin`.
  //
  // The server lets only the OWNER end a group ("Only the owner can end the
  // group"), so treating every admin as owner showed them End Group, which
  // failed with a 403, and hid Leave Group behind the same branch — leaving a
  // non-owner admin with no way out of the group at all.
  const isOwner = Boolean(
    conversation?.myRole === 'OWNER' ||
    (currentUser?.id && (
      String(conversation?.ownerId) === String(currentUser.id) ||
      String(conversation?.hostId) === String(currentUser.id) ||
      String(conversation?.creatorId) === String(currentUser.id)
    ))
  );

  const isClosed = conversation.status === 'Closed' || conversation.isClosed;
  const countFromDetails = conversation.memberDetails?.length || conversation.memberCount || conversation.membersCount;
  const countFromProps = Array.isArray(conversation.members) && conversation.members.length > 0 ? conversation.members.length : (Array.isArray(conversation.participants) && conversation.participants.length > 0 ? conversation.participants.length : 0);
  const memberCount = countFromDetails || countFromProps || conversation.memberCount || 0;
  const pendingRequests = conversation.pendingRequests || [];
  const hasPendingRequests = pendingRequests.length > 0;

  return (
    <div className={styles.msgChatHeader} onClick={onOpenDetails}>
      <button className={styles.msgBackBtn} onClick={(e) => { e.stopPropagation(); onBack(); }} aria-label="Back">
        <ArrowLeft size={20} />
      </button>

      <div className={`${styles.msgChatUser} ${styles.msgChatUserClickable}`}>
        <div style={{ position: 'relative', width: '38px', height: '38px', flexShrink: 0 }}>
          <Avatar src={conversation.avatarKey || conversation.avatar || conversation.icon || conversation.coverImage || conversation.avatarUrl} name={conversation.name} size="38px" isGroup />
        </div>
        <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
          <div className={styles.msgChatName}>
            <span className={styles.msgChatNameText}>{conversation.name}</span>
            {isAdmin && hasPendingRequests && (
              <span 
                className={styles.msgRequestsBadge} 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  onOpenDetails?.(); 
                }}
                title={`${pendingRequests.length} pending join request(s)`}
              >
                {pendingRequests.length} request{pendingRequests.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className={styles.msgChatStatus}>
            {memberCount > 0 ? `${memberCount} member${memberCount > 1 ? 's' : ''}` : 'Group'}
          </div>
        </div>
      </div>

      <div className={styles.msgChatActions} onClick={(e) => e.stopPropagation()}>
        <div style={{ position: 'relative' }}>
          <button 
            {...moreMenu.triggerProps}
            className={`${styles.msgChatActionBtn} ${moreMenu.open ? styles.msgChatActionBtnActive : ''}`}
            title="More Options"
            aria-label="Group chat options"
          >
            <MoreVertical size={18} />
          </button>
          
          <Menu {...moreMenu.menuProps} size="md" ariaLabel="Group chat options">
            {onOpenDetails && (
              <MenuItem icon={Info} onSelect={onOpenDetails} onClose={moreMenu.close}>
                Group info
              </MenuItem>
            )}

            {onToggleSearch && (
              <MenuItem icon={Search} onSelect={onToggleSearch} onClose={moreMenu.close}>
                Find in chat
              </MenuItem>
            )}

            <MenuItem
              icon={isMuted ? NotificationOn : NotificationOff}
              onSelect={() => onToggleMute?.(conversation.id, isMuted)}
              onClose={moreMenu.close}
            >
              {isMuted ? 'Unmute alerts' : 'Mute alerts'}
            </MenuItem>

            {onTogglePin && (
              <MenuItem
                icon={Pin}
                onSelect={() => onTogglePin(conversation.id, conversation.pinned || conversation.isPinned)}
                onClose={moreMenu.close}
              >
                {conversation.pinned || conversation.isPinned ? 'Unpin group' : 'Pin group'}
              </MenuItem>
            )}

            {onClearChat && (
              <MenuItem
                icon={Trash2}
                tone="danger"
                onSelect={() => onClearChat(conversation.id)}
                onClose={moreMenu.close}
              >
                Clear chat
              </MenuItem>
            )}

            {!isClosed && conversation.isMember !== false && (
              isOwner ? (
                <MenuItem
                  icon={LogOut}
                  tone="danger"
                  onSelect={() => { if (onEndGroup) onEndGroup(conversation.id); else onOpenDetails?.(); }}
                  onClose={moreMenu.close}
                >
                  End group
                </MenuItem>
              ) : (
                onLeaveGroup && (
                  <MenuItem icon={LogOut} tone="danger" onSelect={onLeaveGroup} onClose={moreMenu.close}>
                    Leave group
                  </MenuItem>
                )
              )
            )}
          </Menu>
        </div>
      </div>
    </div>
  );
}
