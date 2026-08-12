import { useState, useRef, useEffect, memo, Suspense } from 'react';
import LazyEmojiPicker from '@shared/components/ui/LazyEmojiPicker';
import { useAuth } from '@shared/context/AuthContext';
import { isImageUrl } from '@shared/utils/avatar';
import DefaultAvatar from '@shared/components/avatar/DefaultAvatar';
import Avatar from '@shared/components/avatar/Avatar';
import MentionInput from '@shared/components/mentions/MentionInput';
import MediaGrid from '../post/MediaGrid';
import styles from './PostComposer.module.css';
import { processAndUploadImage, processAndUploadVideo } from '@shared/utils/mediaPipeline';
import { uploadsApi } from '@shared/api/apiClient';

const overlayStyle = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(15, 23, 42, 0.55)',
  backdropFilter: 'blur(2px)',
  borderRadius: '12px',
  zIndex: 15,
};

function PostComposer({ onSubmit }) {
  const { loading, currentUser } = useAuth();
  const [value, setValue] = useState({ text: '', mentions: [] });
  const [media, setMedia] = useState(null);
  const [isPosting, setIsPosting] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showPoll, setShowPoll] = useState(false);
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollMulti, setPollMulti] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const composerRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const emojiPanelRef = useRef(null);
  const pollPanelRef = useRef(null);
  const emojiBtnRef = useRef(null);
  const pollBtnRef = useRef(null);

  // Upload lifecycle: the in-flight upload's AbortController and a promise that
  // resolves to the uploaded descriptor ({ mediaKey, url, type, width, height })
  // or rejects. handlePost awaits this so a fast "Post" click can never race the
  // upload, and a verified storage key is always what reaches the backend.
  const uploadAbortRef = useRef(null);
  const uploadPromiseRef = useRef(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Abort any in-flight upload on unmount + revoke the preview object URL.
  useEffect(() => {
    return () => {
      uploadAbortRef.current?.abort();
      if (media?.previewUrl) {
        try { URL.revokeObjectURL(media.previewUrl); } catch (_) { /* ignore */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasContent = Boolean(
    (typeof value === 'string' ? value : value?.text)?.trim() ||
    media ||
    showPoll ||
    showEmoji
  );

  useEffect(() => {
    const handler = (e) => {
      if (showEmoji && emojiPanelRef.current && !emojiPanelRef.current.contains(e.target) && !emojiBtnRef.current?.contains(e.target)) {
        setShowEmoji(false);
      }
      if (composerRef.current && !composerRef.current.contains(e.target) && !hasContent) {
        setIsExpanded(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmoji, hasContent]);

  const normalizePostText = (str) => {
    if (!str) return '';
    return str
      .trim()
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n');
  };

  const handlePost = async (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (isPosting) return;

    const rawText = typeof value === 'string' ? value : (value?.text || '');
    const text = normalizePostText(rawText);
    const mentions = value?.mentions || [];

    if (showPoll) {
      const opts = pollOptions.map((o) => o.trim()).filter(Boolean);
      if (!text && opts.length < 2 && !media) return;
    } else {
      if (!text && !media) return;
    }

    setIsPosting(true);
    let finalMedia = null;

    try {
      // ── Verify media is uploaded before creating the post ──────────────────
      // The upload was kicked off at selection time. Await whatever state it's in
      // so the post can NEVER reference an un-uploaded/blob file.
      if (media?.file) {
        let uploaded;
        try {
          uploaded = await uploadPromiseRef.current;
        } catch (uploadErr) {
          console.error('[PostComposer] media upload failed, blocking post', uploadErr);
          setMedia((prev) => (prev ? { ...prev, status: 'error', error: uploadErr?.message || 'Upload failed' } : prev));
          setIsPosting(false);
          return; // keep the selection so the user can retry
        }
        if (!uploaded?.mediaKey) {
          setMedia((prev) => (prev ? { ...prev, status: 'error', error: 'Upload did not complete' } : prev));
          setIsPosting(false);
          return;
        }
        finalMedia = uploaded;
      }

      if (showPoll) {
        const opts = pollOptions.map((o) => o.trim()).filter(Boolean);
        await onSubmit(text, { question: text || 'Poll', options: opts, multiSelect: pollMulti }, finalMedia, mentions);
        setPollOptions(['', '']);
        setPollMulti(false);
        setShowPoll(false);
      } else {
        await onSubmit(text, null, finalMedia, mentions);
      }

      // Success — clear composer. The uploaded media is now attached to the post,
      // so there's nothing to discard.
      if (media?.previewUrl) {
        try { URL.revokeObjectURL(media.previewUrl); } catch (_) { /* ignore */ }
      }
      setValue({ text: '', mentions: [] });
      setMedia(null);
      setUploadProgress(0);
      uploadPromiseRef.current = null;
      setIsExpanded(false);
    } catch (err) {
      // Post creation failed AFTER a successful upload — keep the media (still
      // owned + unattached) so the user can retry without re-uploading.
      console.error('[PostComposer] post creation failed', err);
      alert(err?.message || 'Failed to create post. Please try again.');
    } finally {
      setIsPosting(false);
    }
  };

  // Kick off the actual upload immediately on selection, in the background, so
  // by the time the user hits "Post" the media is (usually) already on storage.
  // Resolves to { mediaKey, url, type, width, height }; rejects on failure.
  const startUpload = (file, type, previewUrl) => {
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setUploadProgress(0);

    const uploader = type === 'video'
      ? processAndUploadVideo(file, 'posts', (p) => setUploadProgress(p), controller.signal)
      : processAndUploadImage(file, 'posts', { maxWidthOrHeight: 1920 }, (p) => setUploadProgress(p), controller.signal);

    const promise = uploader.then((res) => {
      const descriptor = {
        mediaKey: res?.key,
        url: res?.publicUrl,
        type,
        width: res?.width || null,
        height: res?.height || null,
      };
      if (!descriptor.mediaKey) throw new Error('Upload did not return a storage key');
      console.info('[PostComposer] media ready', descriptor);
      // Only apply if this upload still corresponds to the current selection.
      setMedia((prev) => (prev && prev.previewUrl === previewUrl
        ? { ...prev, status: 'ready', ...descriptor }
        : prev));
      return descriptor;
    }).catch((err) => {
      if (err?.name === 'AbortError') { console.info('[PostComposer] upload aborted'); throw err; }
      console.error('[PostComposer] upload error', err);
      setMedia((prev) => (prev && prev.previewUrl === previewUrl
        ? { ...prev, status: 'error', error: err?.message || 'Upload failed' }
        : prev));
      throw err;
    });

    uploadPromiseRef.current = promise;
    // Prevent unhandled-rejection noise; handlePost awaits this same promise.
    promise.catch(() => {});
  };

  const removeMedia = () => {
    // Cancel any in-flight upload and clean up an already-uploaded orphan so a
    // discarded selection never leaves a dangling storage object / Media row.
    uploadAbortRef.current?.abort();
    const current = media;
    if (current?.mediaKey && current.status === 'ready') {
      uploadsApi.discard(current.mediaKey).catch(() => { /* best-effort */ });
    }
    if (current?.previewUrl) {
      try { URL.revokeObjectURL(current.previewUrl); } catch (_) { /* ignore */ }
    }
    setMedia(null);
    setUploadProgress(0);
    uploadPromiseRef.current = null;
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const MAX_FILE_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      alert('File too large. Maximum size is 50 MB.');
      e.target.value = '';
      return;
    }

    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) {
      alert('Unsupported file. Please choose an image or video.');
      e.target.value = '';
      return;
    }

    // Replace any previous selection cleanly (abort + discard old orphan).
    if (media) removeMedia();

    const type = isVideo ? 'video' : 'image';
    const previewUrl = URL.createObjectURL(file);
    console.info('[PostComposer] file selected', { name: file.name, type: file.type, size: file.size });
    setMedia({ type, previewUrl, file, status: 'uploading', mediaKey: null, url: null });
    setIsExpanded(true);
    e.target.value = '';

    startUpload(file, type, previewUrl);
  };

  // Retry a failed upload with the same file (no re-selection needed).
  const retryUpload = () => {
    if (!media?.file) return;
    setMedia((prev) => (prev ? { ...prev, status: 'uploading', error: null } : prev));
    startUpload(media.file, media.type, media.previewUrl);
  };

  const togglePoll = () => {
    if (showPoll) {
      setPollOptions(['', '']);
      setPollMulti(false);
    }
    setShowPoll(!showPoll);
    setShowEmoji(false);
    setIsExpanded(true);
  };

  const insertEmoji = (emoji) => {
    setValue((v) => {
      const currentText = typeof v === 'string' ? v : (v?.text || '');
      const currentMentions = v?.mentions || [];
      return { text: currentText + emoji, mentions: currentMentions };
    });
    setIsExpanded(true);
    inputRef.current?.focus();
  };

  const addPollOption = () => {
    if (pollOptions.length < 5) setPollOptions([...pollOptions, '']);
  };

  const removePollOption = (idx) => {
    if (pollOptions.length > 2) setPollOptions(pollOptions.filter((_, i) => i !== idx));
  };

  const updatePollOption = (idx, val) => {
    const next = [...pollOptions];
    next[idx] = val;
    setPollOptions(next);
  };

  const expandedState = isExpanded || hasContent;

  return (
    <div className={styles.postComposerWrapper} ref={composerRef}>
      {/* Popups rendered above the composer */}
      {showEmoji && (
        <div className={styles.emojiPicker} ref={emojiPanelRef}>
          <LazyEmojiPicker
            onEmojiSelect={(emoji) => insertEmoji(emoji.native)}
            theme="light"
          />
        </div>
      )}

      <div
        className={`${styles.postComposer}${showPoll ? ` ${styles.hasPoll}` : ''}${expandedState ? ` ${styles.expanded}` : ''}`}
        onClick={() => { if (!expandedState) setIsExpanded(true); }}
      >
        <div className={styles.composerTopRow}>
          <Avatar src={currentUser?.avatar} name={currentUser?.displayName} size="40px" disableHover isLoading={loading} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <MentionInput
              inputRef={inputRef}
              className={styles.composerInput}
              placeholder={showPoll ? "Ask a question?" : "What's on your mind?"}
              value={value}
              onChange={(val) => {
                setValue(val);
                if (!isExpanded) setIsExpanded(true);
              }}
              onFocus={() => setIsExpanded(true)}
              onSubmit={() => { if (!showPoll) handlePost(); }}
              singleLine={false}
            />
          </div>
          {expandedState && (
            <button
              ref={emojiBtnRef}
              className={`${styles.composerEmojiBtn}${showEmoji ? ` ${styles.active}` : ''}`}
              title="Emoji"
              onClick={(e) => {
                e.stopPropagation();
                if (showPoll) {
                  setPollOptions(['', '']);
                  setPollMulti(false);
                  setShowPoll(false);
                  setValue({ text: '', mentions: [] });
                }
                setShowEmoji(!showEmoji);
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                <line x1="9" y1="9" x2="9.01" y2="9" />
                <line x1="15" y1="9" x2="15.01" y2="9" />
              </svg>
            </button>
          )}
        </div>

        <div className={`${styles.composerExpandContainer}${expandedState ? ` ${styles.expanded}` : ''}`}>
          <div className={styles.composerExpandInner}>
          {showPoll && (
            <div className={styles.inlinePollCreator}>
              <div className={styles.pollOptionsList}>
                {pollOptions.map((opt, i) => {
                  const isLast = i === pollOptions.length - 1;
                  const hasAdd = isLast && pollOptions.length < 5;
                  return (
                    <div key={i} className={styles.pollOptionRow}>
                      <div className={styles.pollOptionInputWrapper}>
                        <input
                          className={styles.pollOptionInput}
                          type="text"
                          placeholder={`Option ${i + 1}`}
                          value={opt}
                          onChange={(e) => updatePollOption(i, e.target.value)}
                        />
                        {pollOptions.length > 2 && (
                          <button className={styles.pollOptionRemove} onClick={() => removePollOption(i)} title="Remove option">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                          </button>
                        )}
                      </div>
                      <div className={styles.pollOptionActionSpace}>
                        {hasAdd && (
                          <button className={styles.pollOptionAdd} onClick={addPollOption} title="Add option">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className={styles.pollCreatorFooter}>
                <label className={styles.pollMultiToggle}>
                  <div className={`${styles.pollToggleTrack}${pollMulti ? ` ${styles.on}` : ''}`} onClick={() => setPollMulti(!pollMulti)}>
                    <div className={styles.pollToggleThumb} />
                  </div>
                  <span>Multiple answers</span>
                </label>
                <button className={styles.pollDiscardBtn} onClick={togglePoll} title="Remove poll">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  Remove Poll
                </button>
              </div>
            </div>
          )}

          {media && (
            <div style={{ position: 'relative', width: '100%' }}>
              <button
                onClick={removeMedia}
                style={{
                  position: 'absolute',
                  top: '14px',
                  right: '10px',
                  background: 'rgba(15, 23, 42, 0.75)',
                  backdropFilter: 'blur(4px)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '50%',
                  width: '30px',
                  height: '30px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  zIndex: 20,
                  transition: 'background 0.2s ease',
                }}
                title="Remove attachment"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>

              <MediaGrid media={[{ url: media.previewUrl, type: media.type }]} />

              {/* Uploading overlay with progress */}
              {media.status === 'uploading' && (
                <div style={overlayStyle}>
                  <div style={{ width: '70%', maxWidth: '220px', height: '6px', background: 'rgba(255,255,255,0.3)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ width: `${uploadProgress}%`, height: '100%', background: '#fff', transition: 'width 0.2s ease' }} />
                  </div>
                  <span style={{ color: '#fff', fontSize: '0.85rem', marginTop: '8px' }}>
                    {uploadProgress < 100 ? `Uploading ${uploadProgress}%` : 'Finishing…'}
                  </span>
                </div>
              )}

              {/* Failed overlay with retry */}
              {media.status === 'error' && (
                <div style={overlayStyle}>
                  <span style={{ color: '#fff', fontSize: '0.85rem', marginBottom: '10px', textAlign: 'center', padding: '0 12px' }}>
                    {media.error || 'Upload failed'}
                  </span>
                  <button
                    type="button"
                    onClick={retryUpload}
                    style={{ background: '#fff', color: '#0f172a', border: 'none', borderRadius: '999px', padding: '6px 16px', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}
                  >
                    Retry upload
                  </button>
                </div>
              )}
            </div>
          )}

          <div className={styles.composerActions}>
            <div className={styles.composerActionsLeft}>
              <input ref={fileRef} type="file" accept="image/*,video/*" onChange={handleFileChange} hidden />
              <button className={styles.composerIconBtn} title="Image" onClick={() => fileRef.current?.click()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                <span>Image</span>
              </button>
              <button className={styles.composerIconBtn} title="Video" onClick={() => fileRef.current?.click()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="7" width="16" height="10" rx="2" ry="2" />
                  <polygon points="18 10 22 8 22 16 18 14" />
                </svg>
                <span>Video</span>
              </button>
              <button
                ref={pollBtnRef}
                className={`${styles.composerIconBtn}${showPoll ? ` ${styles.active}` : ''}`}
                title="Poll"
                onClick={togglePoll}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="9" y1="8" x2="9" y2="16" />
                  <line x1="12" y1="11" x2="12" y2="16" />
                  <line x1="15" y1="6" x2="15" y2="16" />
                </svg>
                <span>Poll</span>
              </button>
            </div>
            <button 
              type="button"
              className={styles.composerSendBtn} 
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                handlePost(e);
              }} 
              disabled={isPosting || !hasContent}
              title="Post"
              style={{ opacity: isPosting || !hasContent ? 0.5 : 1, cursor: isPosting || !hasContent ? 'not-allowed' : 'pointer' }}
            >
              {isPosting ? (
                <div style={{ width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
  );
}

export default memo(PostComposer);

