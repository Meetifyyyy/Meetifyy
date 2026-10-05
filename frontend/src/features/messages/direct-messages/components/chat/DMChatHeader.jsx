import { ArrowLeft, MoreVertical, Search, Trash2 } from '@shared/components/icons';
import Menu, { MenuItem, useMenu } from '@shared/components/ui/Menu';
import Avatar from '@shared/components/avatar/Avatar';
import Skeleton from '@shared/components/skeletons/Skeleton';
import { useCanSeeOthersPresence } from '@shared/hooks/usePresenceVisibility';
import styles from '../../../shared/components/chat/ChatHeader.module.css';

export default function DMChatHeader({ 
  conversation, 
  onBack, 
  onClearChat, 
  onToggleSearch, 
  onOpenDetails,
}) {
  // Outside click, Escape and hardware Back all dismiss this menu — and
  // Back dismisses only the menu, not the chat underneath it.
  /*
   * Outside click, Escape and hardware Back all dismiss this menu, and Back
   * dismisses only the menu rather than the chat underneath it — all provided
   * by `Menu`, so the feature-local `useDismissibleMenu` hook is gone.
   */
  const moreMenu = useMenu();
  const canSeePresence = useCanSeeOthersPresence();

  if (!conversation) return null;

  const isOnline = canSeePresence && Boolean(
    conversation.targetUser ? conversation.targetUser.isOnline : (conversation.isOnline ?? conversation.online ?? false)
  );
  // `blocked` is mutual (the thread is closed either way). Only the person who
  // placed the block may see the badge or the Unblock action — showing either
  // to the other side would disclose the block and offer an action they cannot
  // take.
  const blockedByMe = Boolean(conversation.isBlockedByMe);

  const isGroupConv = conversation.type === 'GROUP' || conversation.isGroup;
  const avatarSrc = isGroupConv
    ? (conversation.avatar || conversation.icon || conversation.coverImage || null)
    : (conversation.avatar || conversation.otherUser?.avatar || conversation.targetUser?.avatar || conversation.icon);

  return (
    <div className={styles.msgChatHeader} onClick={onOpenDetails}>
      <button className={styles.msgBackBtn} onClick={(e) => { e.stopPropagation(); onBack(); }} aria-label="Back">
        <ArrowLeft size={20} />
      </button>

      <div className={`${styles.msgChatUser} ${styles.msgChatUserClickable}`}>
        {conversation.identityPending ? (
          // Who this is has not arrived yet (deep link / reload before the
          // conversation list). One quiet avatar+name block rather than the
          // placeholder name "Chat" and a generic avatar that then swap.
          <>
            <Skeleton type="circle" width="38px" height="38px" />
            <div style={{ minWidth: 0, flex: 1 }} role="status" aria-label="Loading conversation">
              <Skeleton type="text" width="45%" height="0.95rem" style={{ marginBottom: 0 }} />
            </div>
          </>
        ) : (
        <>
        <Avatar src={avatarSrc} name={conversation.name || 'Chat'} size="38px" isGroup={isGroupConv} isOnline={!isGroupConv && isOnline} />
        <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
          <div className={styles.msgChatName}>
            <span className={styles.msgChatNameText}>{conversation.name || 'Chat'}</span>
            {blockedByMe && <span className={styles.msgBlockedBadge}>Blocked</span>}
          </div>
          {isOnline && (
            <div className={styles.msgChatStatus}>Online</div>
          )}
        </div>
        </>
        )}
      </div>

      <div className={styles.msgChatActions} onClick={(e) => e.stopPropagation()}>
        <div style={{ position: 'relative' }}>
          <button 
            {...moreMenu.triggerProps}
            className={`${styles.msgChatActionBtn} ${moreMenu.open ? styles.msgChatActionBtnActive : ''}`}
            title="More Options"
          >
            <MoreVertical size={20} strokeWidth={2.25} />
          </button>
          
          <Menu {...moreMenu.menuProps} size="md" ariaLabel="Chat options">
            {onToggleSearch && (
              <MenuItem icon={Search} onSelect={onToggleSearch} onClose={moreMenu.close}>
                Find in chat
              </MenuItem>
            )}

            {onClearChat && (
              <MenuItem icon={Trash2} tone="danger" onSelect={() => onClearChat(conversation.id)} onClose={moreMenu.close}>
                Clear chat
              </MenuItem>
            )}
          </Menu>
        </div>
      </div>
    </div>
  );
}
