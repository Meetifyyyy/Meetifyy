import { ArrowLeft, MoreVertical, Search, NotificationOff, NotificationOn, Trash2, ShieldOff, Info, Pin } from '@shared/components/icons';
import Menu, { MenuItem, useMenu } from '@shared/components/ui/Menu';
import Avatar from '@shared/components/avatar/Avatar';
import { useCanSeeOthersPresence } from '@shared/hooks/usePresenceVisibility';
import styles from '../../../shared/components/chat/ChatHeader.module.css';

export default function DMChatHeader({ 
  conversation, 
  onBack, 
  onBlock, 
  onClearChat, 
  onTogglePin,
  onToggleMute,
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

  // Muted state comes from the shared conversation cache, never from local
  // component state. The button used to flip a `useState` and nothing else:
  // the label toggled, no request was ever sent, and the state was lost on
  // remount — the chat was never actually muted. Reading the cache means this
  // button, the sidebar context menu and the notification suppression all
  // observe one value, and the optimistic write updates all three at once.
  const isMuted = Boolean(conversation.muted ?? conversation.isMuted);

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
      </div>

      <div className={styles.msgChatActions} onClick={(e) => e.stopPropagation()}>
        <div style={{ position: 'relative' }}>
          <button 
            {...moreMenu.triggerProps}
            className={`${styles.msgChatActionBtn} ${moreMenu.open ? styles.msgChatActionBtnActive : ''}`}
            title="More Options"
          >
            <MoreVertical size={18} />
          </button>
          
          <Menu {...moreMenu.menuProps} size="md" ariaLabel="Chat options">
            {onOpenDetails && (
              <MenuItem icon={Info} onSelect={onOpenDetails} onClose={moreMenu.close}>
                Contact info
              </MenuItem>
            )}

            {onTogglePin && (
              <MenuItem
                icon={Pin}
                onSelect={() => onTogglePin(conversation.id, conversation.pinned || conversation.isPinned)}
                onClose={moreMenu.close}
              >
                {conversation.pinned || conversation.isPinned ? 'Unpin chat' : 'Pin chat'}
              </MenuItem>
            )}

            {onToggleSearch && (
              <MenuItem icon={Search} onSelect={onToggleSearch} onClose={moreMenu.close}>
                Find in chat
              </MenuItem>
            )}

            {/* Rendered only when it can act, like every other item here. It
                used to render unconditionally with an optional-call handler,
                so on a draft it drew a row that did nothing. */}
            {onToggleMute && (
              <MenuItem
                icon={isMuted ? NotificationOn : NotificationOff}
                onSelect={() => onToggleMute(conversation.id, isMuted)}
                onClose={moreMenu.close}
              >
                {isMuted ? 'Unmute alerts' : 'Mute alerts'}
              </MenuItem>
            )}

            {onClearChat && (
              <MenuItem icon={Trash2} tone="danger" onSelect={() => onClearChat(conversation.id)} onClose={moreMenu.close}>
                Clear chat
              </MenuItem>
            )}

            {onBlock && (
              <MenuItem
                icon={ShieldOff}
                tone="danger"
                onSelect={() => {
                  const targetId = conversation.targetUser?.id || conversation.userId;
                  if (targetId) onBlock(targetId, blockedByMe);
                }}
                onClose={moreMenu.close}
              >
                {blockedByMe ? 'Unblock contact' : 'Block contact'}
              </MenuItem>
            )}
          </Menu>
        </div>
      </div>
    </div>
  );
}
