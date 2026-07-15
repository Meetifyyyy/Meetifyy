import { useEffect, useRef, Fragment } from 'react';
import MessageRowSkeleton from '../skeletons/MessageRowSkeleton';
import { ErrorState } from '@shared/components/ui/StateViews';
import MessageBubble from './MessageBubble';
import styles from './ChatMessageList.module.css';

const getRelativeDateString = (date) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const msgDate = new Date(date);
  msgDate.setHours(0, 0, 0, 0);
  
  const diffTime = today.getTime() - msgDate.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return 'Today';
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return msgDate.toLocaleDateString(undefined, { weekday: 'long' });
  } else {
    return msgDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
};

const getMessageDateGroup = (msg) => {
  if (msg.timestamp) {
    return getRelativeDateString(new Date(msg.timestamp));
  }
  
  const time = msg.time || '';
  const clean = time.toLowerCase().trim();
  
  if (clean.includes('yesterday')) {
    return 'Yesterday';
  }
  if (clean === '1d ago') {
    return 'Yesterday';
  }
  if (clean.includes('2d ago')) {
    const d = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }
  if (clean.includes('3d ago') || clean.includes('4d ago') || clean.includes('5d ago') || clean.includes('6d ago') || clean.includes('7d ago')) {
    const match = clean.match(/(\d+)d\s+ago/);
    if (match) {
      const days = parseInt(match[1], 10);
      const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    }
  }
  if (clean.includes('ago') || clean.includes('am') || clean.includes('pm') || clean.match(/^\d{1,2}:\d{2}$/)) {
    return 'Today';
  }
  
  return 'Today';
};

export default function ChatMessageList({
  isLoading,
  error,
  retry,
  loadedMessages,
  conversation,
  currentUser,
  users,
  initial,
  searchQuery,
  openViewer,
  onReply,
  onRetryMessage,
  isTyping,
  replyingTo
}) {
  const bodyRef = useRef(null);

  const lastOutgoingMsgIndex = (() => {
    if (!loadedMessages) return -1;
    for (let i = loadedMessages.length - 1; i >= 0; i--) {
      if (loadedMessages[i].from === 'me') {
        return i;
      }
    }
    return -1;
  })();

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [loadedMessages?.length, replyingTo]);

  let lastDateGroup = null;

  return (
    <div className={styles.msgChatBody} ref={bodyRef}>
      {isLoading && (
        <MessageRowSkeleton />
      )}

      {!isLoading && error && (
        <ErrorState onRetry={retry} />
      )}

      {!isLoading && !error && loadedMessages && loadedMessages.length === 0 ? (
        <div className={styles.msgEmptyState}>No messages in this chat.</div>
      ) : (
        !isLoading && !error && loadedMessages && loadedMessages.map((msg, i) => {
          const dateGroup = getMessageDateGroup(msg);
          const showSeparator = dateGroup !== lastDateGroup;
          lastDateGroup = dateGroup;

          return (
            <Fragment key={msg.id || i}>
              {showSeparator && (
                <div className={styles.msgDateSeparator}>
                  <span className={styles.msgDateSeparatorLine}></span>
                  <span className={styles.msgDateSeparatorText}>{dateGroup}</span>
                  <span className={styles.msgDateSeparatorLine}></span>
                </div>
              )}
              <MessageBubble
                index={i}
                isLastOutgoing={i === lastOutgoingMsgIndex}
                onRetry={onRetryMessage}
                msg={msg}
                conversation={conversation}
                currentUser={currentUser}
                users={users}
                initial={initial}
                searchQuery={searchQuery}
                openViewer={openViewer}
                onReply={onReply}
              />
            </Fragment>
          );
        })
      )}
      {isTyping && !isLoading && (
        <div className={`${styles.msgBubbleContainer} ${styles.msgBubbleContainerThem}`}>
          <div className={styles.msgBubbleWrapper}>
            <div className={`${styles.msgBubble} ${styles.msgBubbleThem}`}>
              <div className={styles.typingIndicator}>
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
