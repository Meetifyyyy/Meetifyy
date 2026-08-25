import { useDismissibleMenu } from '../../../shared/hooks/useDismissibleMenu';
import { ArrowLeft, MoreVertical, Search, NotificationOff, NotificationOn, Trash2, ShieldOff, Info, Pin } from '@shared/components/icons';
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
  const {
    open: showMoreMenu, setOpen: setShowMoreMenu, toggle: toggleMoreMenu, anchorRef: moreMenuRef,
  } = useDismissibleMenu();
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
        <div style={{ position: 'relative' }} ref={moreMenuRef}>
          <button 
            className={`${styles.msgChatActionBtn} ${showMoreMenu ? styles.msgChatActionBtnActive : ''}`} 
            title="More Options"
            onClick={toggleMoreMenu}
          >
            <MoreVertical size={18} />
          </button>
          
          {showMoreMenu && (
            <div className={styles.msgMoreDropdown}>
              {onOpenDetails && (
                <button 
                  className={styles.msgDropdownItem} 
                  onClick={() => { onOpenDetails(); setShowMoreMenu(false); }}
                >
                  <Info size={14} />
                  Contact Info
                </button>
              )}

              {onTogglePin && (
                <button 
                  className={styles.msgDropdownItem} 
                  onClick={() => { onTogglePin(conversation.id, conversation.pinned || conversation.isPinned); setShowMoreMenu(false); }}
                >
                  <Pin size={14} />
                  {conversation.pinned || conversation.isPinned ? 'Unpin Chat' : 'Pin Chat'}
                </button>
              )}

              {onToggleSearch && (
                <button 
                  className={styles.msgDropdownItem} 
                  onClick={() => { onToggleSearch(); setShowMoreMenu(false); }}
                >
                  <Search size={14} />
                  Find in chat
                </button>
              )}
              <button 
                className={styles.msgDropdownItem} 
                onClick={() => { onToggleMute?.(conversation.id, isMuted); setShowMoreMenu(false); }}
              >
                {isMuted ? <NotificationOn size={14} /> : <NotificationOff size={14} />}
                {isMuted ? 'Unmute alerts' : 'Mute alerts'}
              </button>
              {onClearChat && (
                <button 
                  className={styles.msgDropdownItem} 
                  onClick={() => { onClearChat(conversation.id); setShowMoreMenu(false); }}
                >
                  <Trash2 size={14} />
                  Clear Chat
                </button>
              )}
              {onBlock && (
                <button 
                  className={`${styles.msgDropdownItem} ${styles.msgDropdownItemDanger}`} 
                  onClick={() => {
                    const targetId = conversation.targetUser?.id || conversation.userId;
                    if (targetId) onBlock(targetId, blockedByMe);
                    setShowMoreMenu(false);
                  }}
                >
                  <ShieldOff size={14} />
                  {blockedByMe ? 'Unblock Contact' : 'Block Contact'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
