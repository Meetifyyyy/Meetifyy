import { useState, useRef, Suspense, lazy } from 'react';
import MentionInput from '@shared/components/mentions/MentionInput';
import data from '@emoji-mart/data';
import styles from './ChatInputAreaStyles.module.css';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';

const Picker = lazy(() => import('@emoji-mart/react'));

import { useR2Upload } from '@shared/hooks/useR2Upload';

export default function ChatInputArea({
  conversation,
  currentUser,
  onSendMessage,
  replyingTo,
  onCancelReply,
  setIsTyping,
  onJoinGroup,
  onBlockUser,
  showToast
}) {
  const [inputValue, setInputValue] = useState({ text: '', mentions: [] });
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const fileInputRef = useRef(null);
  const { upload: uploadChatMedia } = useR2Upload('chat-media');

  const hasText = !!(typeof inputValue === 'string' ? inputValue : (inputValue?.text || '')).trim();

  const { isRecording, recordingTime, startRecording, deleteRecording, sendRecording, formatDuration } = useVoiceRecorder({
    onSend: (audioUrl) => onSendMessage(conversation.id, '', replyingTo, [], audioUrl, 'audio'),
    showToast
  });

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const MAX_FILE_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      if (showToast) showToast('File too large. Maximum size is 50 MB.');
      e.target.value = '';
      return;
    }

    const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg'];
    const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];
    
    if (!ALLOWED_TYPES.includes(file.type)) {
      if (showToast) showToast('Unsupported file type.');
      e.target.value = '';
      return;
    }

    let mediaType = file.type.startsWith('video/') ? 'video' : 'image';

    setIsUploadingMedia(true);
    try {
      const publicUrl = await uploadChatMedia(file);
      onSendMessage(conversation.id, '', replyingTo, [], publicUrl, mediaType);
      if (onCancelReply) onCancelReply();
    } catch {
      if (showToast) showToast('Failed to upload attachment.');
    } finally {
      setIsUploadingMedia(false);
      e.target.value = '';
    }
  };

  const handleSend = () => {
    const text = (typeof inputValue === 'string' ? inputValue : (inputValue?.text || '')).trim();
    const mentions = inputValue?.mentions || [];
    if (!text || conversation?.blocked || conversation?.isBlockedByMe || conversation?.isBlockedByThem) return;

    onSendMessage(conversation.id, text, replyingTo, mentions, null, null, null, null);
    setInputValue({ text: '', mentions: [] });
    setShowEmojiPicker(false);
    if (onCancelReply) onCancelReply();
  };

  const isClosed = conversation?.status === 'Closed';
  const isExpiredInstantMatch = conversation?.isInstantMatch && conversation?.expiresAt && new Date(conversation.expiresAt).getTime() < Date.now();

  if (isClosed || isExpiredInstantMatch) {
    return (
      <div className={styles.msgChatInputWrap} style={{ justifyContent: 'center', padding: '1rem' }}>
        <div className={styles.msgBlockedNotice} style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
          {isClosed ? 'This activity/conversation has ended.' : 'This 24-hour instant match has expired.'}
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
            <span className={styles.msgReplyPreviewText}>{replyingTo.text}</span>
          </div>
          <button className={styles.msgReplyPreviewClose} onClick={onCancelReply}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {showEmojiPicker && (
        <div style={{ position: 'absolute', bottom: '100%', left: '1.25rem', marginBottom: '0.5rem', zIndex: 100 }}>
          <Suspense fallback={<div style={{ padding: '1rem', background: 'var(--color-bg-white)', borderRadius: '12px', border: '1px solid #e4e4e7', fontSize: '0.85rem' }}>Loading Emojis...</div>}>
            <Picker 
              data={data} 
              onEmojiSelect={(emoji) => setInputValue((prev) => {
                const currentText = typeof prev === 'string' ? prev : (prev?.text || '');
                const currentMentions = prev?.mentions || [];
                return { text: currentText + emoji.native, mentions: currentMentions };
              })} 
              theme="light"
            />
          </Suspense>
        </div>
      )}
      
      {(() => {
        const isOwner = conversation?.ownerId && String(conversation.ownerId) === String(currentUser?.id);
        const rawParticipants = conversation?.members || conversation?.participants;
        const hasParticipantsInfo = Array.isArray(rawParticipants) && rawParticipants.length > 0;
        const participantIds = hasParticipantsInfo ? rawParticipants.map(p => String(p?.userId || p?.id || p)) : [];
        const isNotMember = conversation?.isGroup && !isOwner && hasParticipantsInfo && !participantIds.includes(String(currentUser?.id));

        if (isNotMember) {
          return (
            <div className={styles.msgBlockedInputOverlay}>
              <span style={{ color: 'var(--color-text-main)', fontWeight: 'bold' }}>
                {String(conversation.id).startsWith('c_') ? 'You are not a member of this campus group.' : 'You are no longer a member of this group.'}
              </span>
              {String(conversation.id).startsWith('c_') && (
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

        if (conversation.isBlockedByMe || conversation.blocked) {
          return (
            <div className={styles.msgBlockedInputOverlay}>
              <span>This contact is blocked.</span>
              <button 
                type="button" 
                className={styles.unblockBannerBtn}
                onClick={onBlockUser}
              >
                Unblock
              </button>
            </div>
          );
        }

        if (isRecording) {
          return (
            <div className={styles.msgRecordingContainer}>
              <div className={styles.msgRecordingLeft}>
                <span className={styles.msgRecordingDot} />
                <span className={styles.msgRecordingTime}>{formatDuration(recordingTime)}</span>
              </div>
              <div className={styles.msgRecordingActions}>
                <button 
                  type="button" 
                  className={styles.msgRecordingDeleteBtn} 
                  onClick={deleteRecording}
                  title="Delete Recording"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
                <button 
                  type="button" 
                  className={styles.msgRecordingSendBtn} 
                  onClick={sendRecording}
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
              accept="image/*,video/*"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />

            <button className={styles.msgEmojiBtn} title="Emoji" onClick={() => setShowEmojiPicker(!showEmojiPicker)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9" y2="9" /><line x1="15" y1="9" x2="15" y2="9" />
              </svg>
            </button>

            <button 
              className={`${styles.msgAttachBtn} ${hasText ? styles.attachBtnHidden : ''}`} 
              title="Attach image or video" 
              onClick={handleAttachClick}
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>

            <div className={styles.inputWrapper}>

              <MentionInput
                className={styles.msgInput}
                placeholder="Type a message..."
                value={inputValue}
                onChange={setInputValue}
                onSubmit={handleSend}
                singleLine={true}
                communityId={conversation?.isGroup || conversation?.isActivityChat ? conversation?.id : null}
              />
            </div>

            <div className={styles.rightActionContainer}>
              {hasText ? (
                <button 
                  type="button"
                  className={styles.msgSendBtn} 
                  onClick={handleSend}
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
