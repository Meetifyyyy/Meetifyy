import { useState, useRef, useEffect } from 'react';
import MentionInput from '@shared/components/mentions/MentionInput';
import LazyEmojiPicker from '@shared/components/ui/LazyEmojiPicker';
import styles from './ChatInputAreaStyles.module.css';
import { useVoiceRecorder } from '@features/messages/hooks/useVoiceRecorder';
import { showToast } from '@shared/utils/toast';
import { ALLOWED_MEDIA_ACCEPT } from '@shared/constants/mediaLimits';
import ReplyPreviewContent from './ReplyPreviewContent';
import LiveWaveform from './LiveWaveform';

export default function ChatInputArea({
  conversation,
  onSendMessage: propOnSendMessage,
  onSend,
  replyingTo,
  onCancelReply,
  onJoinGroup,
  onBlockUser,
  onTyping,
  stopTypingNow,
  disabled,
  disabledReason,
}) {
  const sendMessageFn = propOnSendMessage || onSend;
  const [inputValue, setInputValue] = useState({ text: '', mentions: [] });
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (replyingTo) {
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          try {
            const sel = window.getSelection();
            if (sel && inputRef.current.childNodes.length > 0) {
              const range = document.createRange();
              range.selectNodeContents(inputRef.current);
              range.collapse(false);
              sel.removeAllRanges();
              sel.addRange(range);
            }
          } catch (e) {
            // Ignore selection errors on non-contenteditable elements
          }
        }
      });
    }
  }, [replyingTo]);


  const hasText = !!(typeof inputValue === 'string' ? inputValue : (inputValue?.text || '')).trim();

  const {
    isRecording,
    isUploading: isUploadingVoice,
    recordingTime,
    startRecording,
    deleteRecording,
    sendRecording,
    formatDuration,
    levelsRef: voiceLevelsRef,
  } = useVoiceRecorder({
    // A recording already in flight when the composer is disabled must not
    // land: the upload finishes asynchronously, well after the UI has changed.
    onSend: (audioUrl, mediaType, duration) => !disabled && sendMessageFn && sendMessageFn(conversation.id, '', replyingTo, [], audioUrl, 'audio', null, null, { duration }),
    showToast: (msg) => showToast(msg, 'error'),
  });

  const handleAttachClick = () => {
    if (disabled) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Covers a picker that was already open when the composer was disabled.
    if (disabled) {
      e.target.value = '';
      return;
    }

    const MAX_FILE_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      if (showToast) showToast('File too large (max 50MB)', 'error');
      e.target.value = '';
      return;
    }

    const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg'];
    const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];
    
    if (!ALLOWED_TYPES.includes(file.type)) {
      if (showToast) showToast('Unsupported file type', 'error');
      e.target.value = '';
      return;
    }

    const mediaType = file.type.startsWith('video/') ? 'video' : 'image';
    const localUrl = URL.createObjectURL(file);
    const tempId = 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

    if (sendMessageFn) {
      sendMessageFn(
        conversation.id,
        '',
        replyingTo,
        [],
        localUrl,
        mediaType,
        null,
        null,
        { tempId, fileObj: file }
      );
    }

    if (onCancelReply) onCancelReply();
    e.target.value = '';
  };

  const handleSend = () => {
    const text = (typeof inputValue === 'string' ? inputValue : (inputValue?.text || '')).trim();
    const mentions = inputValue?.mentions || [];
    // `disabled` is re-checked here, not only at render: MentionInput's own
    // Enter handling calls straight into this, so a composer that becomes
    // unavailable between keystroke and submit must still refuse.
    if (!text || disabled || conversation?.blocked || conversation?.isBlockedByMe || conversation?.isBlockedByThem) return;
    // Belt to the overlay's braces: the overlay replaces the composer, but a
    // queued draft or an offline replay can still reach this handler.
    if (conversation?.targetUserUnavailable || conversation?.targetUser?.isDeleted) return;

    if (stopTypingNow) stopTypingNow();

    if (sendMessageFn) {
      sendMessageFn(conversation.id, text, replyingTo, mentions, null, null, null, null);
    }
    setInputValue({ text: '', mentions: [] });
    setShowEmojiPicker(false);
    if (onCancelReply) onCancelReply();

    // Retain cursor inside textbox on mobile and desktop after sending
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  const isClosed = conversation?.status === 'Closed';
  const isNotMember = (conversation?.type === 'GROUP' || conversation?.isGroup) && conversation?.isMember === false;
  // Also respect the parent-level disabled flag (e.g. blocked DM, ended activity)
  const isDisabledByParent = !!disabled;

  if (isClosed || isNotMember || isDisabledByParent) {
    // Same shell, same overlay, same typography as the block state below —
    // the chat keeps its shape and only the composer's contents change. The
    // composer is not rendered at all in this branch, which is what makes the
    // restriction complete rather than cosmetic: there is no text box to type
    // in, no Enter to intercept, no attach/emoji/GIF/mic button, and no
    // contenteditable to paste or drop media onto.
    return (
      <div className={styles.msgChatInputWrap}>
        <div className={styles.msgBlockedInputOverlay} role="status">
          <span>
            {disabledReason
              ? disabledReason
              : isClosed
              ? 'This activity/conversation has ended.'
              : "You can't send messages because you're no longer in this group."}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.msgChatInputWrap}>
      {/* Reply preview bar */}
      {replyingTo && (
        <div className={styles.msgReplyPreview}>
          <div className={styles.msgReplyPreviewDetails}>
            <span className={styles.msgReplyPreviewLabel}>
              Replying to {replyingTo.from === 'me' ? 'yourself' : (replyingTo.senderName || conversation.name)}
            </span>
            {/* Same resolver as the sent bubble, so the quote the sender sees
                while typing matches what everyone sees afterwards. */}
            <ReplyPreviewContent message={replyingTo} textClassName={styles.msgReplyPreviewText} />
          </div>
          <button className={styles.msgReplyPreviewClose} onClick={onCancelReply}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}


      
      {(() => {
        const isNotMember = conversation?.isGroup && conversation?.isMember === false;

        const isCampusGroup = String(conversation?.id).startsWith('c_') || conversation?.isCampusGroup;
        if (isNotMember) {
          return (
            <div className={styles.msgBlockedInputOverlay}>
              <span style={{ color: 'var(--color-text-main)', fontWeight: 'bold' }}>
                {isCampusGroup ? 'You are not a member of this campus group.' : 'You are no longer a member of this group.'}
              </span>
              {isCampusGroup && (
                <button 
                  type="button" 
                  className={styles.unblockBannerBtn}
                  onClick={() => onJoinGroup(conversation.id)}
                  style={{ marginLeft: '1rem' }}
                >
                  Join Group
                </button>
              )}
            </div>
          );
        }

        // A deleted partner is checked before the block states: it is the
        // stronger and more permanent condition, and unlike a block it can
        // never be lifted, so offering an Unblock affordance underneath it
        // would be misleading. The server refuses the send either way — this
        // notice exists so the person understands why, not to enforce it.
        if (conversation?.targetUserUnavailable || conversation?.targetUser?.isDeleted) {
          return (
            <div className={styles.msgBlockedInputOverlay}>
              <span>This user is no longer available.</span>
            </div>
          );
        }

        // The two block states are rendered separately and must stay that way.
        //
        // Only the person who placed the block is offered Unblock — showing that
        // button to the other side would both mislead them (they have nothing to
        // unblock) and disclose the block.
        if (conversation.isBlockedByMe) {
          return (
            <div className={styles.msgBlockedInputOverlay}>
              <span>You blocked this user. Unblock them to continue messaging.</span>
              <button 
                type="button" 
                className={styles.unblockBannerBtn}
                onClick={() => {
                  // Was `onClick={onBlockUser}`, which handed the click Event
                  // in as the target user id.
                  const targetId = conversation.targetUser?.id || conversation.userId;
                  if (onBlockUser && targetId) onBlockUser(targetId, true);
                }}
              >
                Unblock
              </button>
            </div>
          );
        }

        // Shown to the blocked user, and to anyone whose thread is closed for a
        // reason we do not name. Deliberately identical to the message used for
        // restricted and limited accounts, so it reveals nothing about why —
        // and carries no Unblock affordance.
        if (conversation.isBlockedByThem || conversation.blocked) {
          return (
            <div className={styles.msgBlockedInputOverlay}>
              <span>You can no longer send messages to this user.</span>
            </div>
          );
        }

        if (isRecording || isUploadingVoice) {
          return (
            <div className={styles.msgRecordingContainer}>
              <div className={styles.msgRecordingLeft}>
                <span className={styles.msgRecordingDot} />
                <span className={styles.msgRecordingTime}>
                  {isUploadingVoice ? 'Sending…' : formatDuration(recordingTime)}
                </span>
              </div>
              <LiveWaveform
                levelsRef={voiceLevelsRef}
                active={isRecording}
                className={styles.msgRecordingWaveform}
              />
              <div className={styles.msgRecordingActions}>
                <button 
                  type="button" 
                  className={styles.msgRecordingDeleteBtn} 
                  onClick={deleteRecording}
                  title={isUploadingVoice ? 'Cancel' : 'Delete Recording'}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
                <button 
                  type="button" 
                  className={styles.msgRecordingSendBtn} 
                  onClick={sendRecording}
                  disabled={isUploadingVoice}
                  title="Send Voice Message"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </div>
            </div>
          );
        }

        return (
          <>
            {/* Hidden file input for attachments */}
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_MEDIA_ACCEPT}
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />

            {showEmojiPicker && (
              <div style={{ position: 'absolute', bottom: '100%', left: '1.25rem', marginBottom: '0.5rem', zIndex: 100 }}>
                <LazyEmojiPicker
                  onEmojiSelect={(emoji) => {
                    if (inputRef.current?.insertTextAtCursor) {
                      inputRef.current.insertTextAtCursor(emoji.native);
                    } else {
                      setInputValue(prev => {
                        const curText = typeof prev === 'string' ? prev : (prev?.text || '');
                        return typeof prev === 'string' ? curText + emoji.native : { ...prev, text: curText + emoji.native };
                      });
                      inputRef.current?.focus();
                    }
                    setShowEmojiPicker(false);
                  }}
                />
              </div>
            )}

            <div className={styles.leftActions}>
              <button type="button" className={styles.msgEmojiBtn} title="Emoji" onClick={() => setShowEmojiPicker(!showEmojiPicker)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9" y2="9" /><line x1="15" y1="9" x2="15" y2="9" />
                </svg>
              </button>

              <button 
                type="button"
                className={`${styles.msgAttachBtn} ${hasText ? styles.attachBtnHidden : ''}`} 
                title="Attach image or video" 
                onClick={handleAttachClick}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="5" ry="5" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
              </button>
            </div>

            <div className={styles.inputBar}>
              <div className={styles.inputWrapper}>
                <MentionInput
                  inputRef={inputRef}
                  className={styles.msgInput}
                  placeholder="Type a message..."
                  value={inputValue}
                  onChange={(val) => {
                    setInputValue(val);
                    if (onTyping) onTyping();
                  }}
                  onSubmit={handleSend}
                  singleLine={true}
                  communityId={(conversation?.type === 'GROUP' || conversation?.isGroup) ? conversation?.id : null}
                />
              </div>
            </div>

            <div className={styles.rightActionContainer}>
              {hasText ? (
                <button 
                  type="button"
                  className={styles.msgSendBtn} 
                  onClick={handleSend}
                  onMouseDown={(e) => e.preventDefault()}
                  title="Send"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              ) : (
                <button 
                  type="button"
                  className={styles.msgMicBtn} 
                  onClick={startRecording}
                  title="Record Voice"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="22" />
                  </svg>
                </button>
              )}
            </div>
          </>
        );
      })()}
    </div>
  );
}
