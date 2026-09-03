import { useState, useRef, useEffect, memo, forwardRef, useImperativeHandle } from 'react';
import LazyEmojiPicker from '@shared/components/ui/LazyEmojiPicker';
import { useAuth } from '@shared/context/AuthContext';
import Avatar from '@shared/components/avatar/Avatar';
import MentionInput from '@shared/components/mentions/MentionInput';
import MediaGrid from '../post/MediaGrid';
import styles from './PostComposer.module.css';
import { processAndUploadImage, processAndUploadVideo } from '@shared/utils/mediaPipeline';
import { uploadsApi } from '@shared/api/apiClient';
import { showToast } from '@shared/utils/toast';
import { normalizeBodyText } from '@shared/utils/bodyText';
import { ALLOWED_IMAGE_ACCEPT } from '@shared/constants/mediaLimits';

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

const PostComposer = forwardRef(function PostComposer({ onSubmit }, ref) {
  const { loading, currentUser } = useAuth();
  const [value, setValue] = useState({ text: '', mentions: [] });
  const [media, setMedia] = useState([]);
  const [isPosting, setIsPosting] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showPoll, setShowPoll] = useState(false);
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollMulti, setPollMulti] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const composerRef = useRef(null);
  const inputRef = useRef(null);
  const imageFileRef = useRef(null);
  const videoFileRef = useRef(null);
  const emojiPanelRef = useRef(null);
  const emojiBtnRef = useRef(null);
  const pollBtnRef = useRef(null);

  useImperativeHandle(ref, () => ({
    focus: () => {
      setIsExpanded(true);
      if (inputRef.current) {
        inputRef.current.focus();
        composerRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      }
    }
  }), []);

  // Maps of previewUrl -> AbortController/Promise
  const uploadAbortRefs = useRef(new Map());
  const uploadPromiseRefs = useRef(new Map());

  // Abort any in-flight upload on unmount + revoke preview URLs
  useEffect(() => {
    return () => {
      uploadAbortRefs.current.forEach(controller => controller.abort());
      media.forEach(m => {
        if (m.previewUrl) {
          try { URL.revokeObjectURL(m.previewUrl); } catch (_) {}
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasContent = Boolean(
    (typeof value === 'string' ? value : value?.text)?.trim() ||
    media.length > 0 ||
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

  const handlePost = async (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (isPosting) return;

    const rawText = typeof value === 'string' ? value : (value?.text || '');
    const text = normalizeBodyText(rawText);
    const mentions = value?.mentions || [];

    if (showPoll) {
      const opts = pollOptions.map((o) => o.trim()).filter(Boolean);
      if (!text && opts.length < 2 && media.length === 0) return;
    } else {
      if (!text && media.length === 0) return;
    }

    setIsPosting(true);
    let finalMedia = [];

    try {
      if (media.length > 0) {
        const promises = media.map(m => uploadPromiseRefs.current.get(m.previewUrl));
        const results = [];
        
        for (let i = 0; i < media.length; i++) {
          let uploaded;
          try {
            uploaded = await promises[i];
          } catch (uploadErr) {
            console.error('[PostComposer] media upload failed', uploadErr);
            setMedia((prev) => prev.map((p, idx) => idx === i ? { ...p, status: 'error', error: uploadErr?.message || 'Upload failed' } : p));
            setIsPosting(false);
            return;
          }
          if (!uploaded?.mediaKey) {
            setMedia((prev) => prev.map((p, idx) => idx === i ? { ...p, status: 'error', error: 'Upload did not complete' } : p));
            setIsPosting(false);
            return;
          }
          results.push(uploaded);
        }
        finalMedia = results;
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

      media.forEach(m => {
        if (m.previewUrl) {
          try { URL.revokeObjectURL(m.previewUrl); } catch (_) {}
        }
      });
      setValue({ text: '', mentions: [] });
      setMedia([]);
      uploadPromiseRefs.current.clear();
      uploadAbortRefs.current.clear();
      setIsExpanded(false);
    } catch (err) {
      console.error('[PostComposer] post creation failed', err);
      showToast(err?.message || 'Post failed', 'error');
    } finally {
      setIsPosting(false);
    }
  };

  // Kick off the actual upload immediately on selection, in the background, so
  // by the time the user hits "Post" the media is (usually) already on storage.
  // Resolves to { mediaKey, url, type, width, height }; rejects on failure.
  const startUpload = (file, type, previewUrl) => {
    const controller = new AbortController();
    uploadAbortRefs.current.set(previewUrl, controller);

    const uploader = type === 'video'
      ? processAndUploadVideo(file, 'posts', (p) => {
          setMedia((prev) => prev.map(m => m.previewUrl === previewUrl ? { ...m, progress: p } : m));
        }, controller.signal)
      : processAndUploadImage(file, 'posts', { maxWidthOrHeight: 1920 }, (p) => {
          setMedia((prev) => prev.map(m => m.previewUrl === previewUrl ? { ...m, progress: p } : m));
        }, controller.signal);

    const promise = uploader.then((res) => {
      const descriptor = {
        mediaKey: res?.key,
        url: res?.publicUrl,
        type,
        width: res?.width || null,
        height: res?.height || null,
      };
      if (!descriptor.mediaKey) throw new Error('Upload did not return a storage key');
      
      setMedia((prev) => prev.map(m => m.previewUrl === previewUrl ? { ...m, status: 'ready', ...descriptor } : m));
      return descriptor;
    }).catch((err) => {
      if (err?.name === 'AbortError') throw err;
      console.error('[PostComposer] upload error', err);
      setMedia((prev) => prev.map(m => m.previewUrl === previewUrl ? { ...m, status: 'error', error: err?.message || 'Upload failed' } : m));
      throw err;
    });

    uploadPromiseRefs.current.set(previewUrl, promise);
    promise.catch(() => {});
  };

  const removeMedia = (previewUrl) => {
    uploadAbortRefs.current.get(previewUrl)?.abort();
    uploadAbortRefs.current.delete(previewUrl);
    uploadPromiseRefs.current.delete(previewUrl);

    setMedia((prev) => {
      const current = prev.find(m => m.previewUrl === previewUrl);
      if (current?.mediaKey && current.status === 'ready') {
        uploadsApi.discard(current.mediaKey).catch(() => {});
      }
      if (current?.previewUrl) {
        try { URL.revokeObjectURL(current.previewUrl); } catch (_) {}
      }
      return prev.filter(m => m.previewUrl !== previewUrl);
    });
  };

  const handleFileChange = (e, expectedType) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    let availableSlots = 6 - media.length;
    if (availableSlots <= 0) {
      showToast('Maximum 6 media items allowed', 'error');
      e.target.value = '';
      return;
    }

    let filesToProcess = files;
    if (files.length > availableSlots) {
      filesToProcess = files.slice(0, availableSlots);
      showToast('Max 6 files allowed.', 'error');
    }

    const MAX_FILE_SIZE = 50 * 1024 * 1024;
    const newMedia = [];

    for (const file of filesToProcess) {
      if (file.size > MAX_FILE_SIZE) {
        showToast('File size limit is 50MB', 'error');
        continue;
      }

      const isVideo = file.type.startsWith('video/');
      const isImage = file.type.startsWith('image/');

      if (expectedType === 'image' && !isImage) {
        showToast('Please select an image file.', 'error');
        continue;
      }

      if (expectedType === 'video' && !isVideo) {
        showToast('Please select a video file.', 'error');
        continue;
      }

      if (!isVideo && !isImage) {
        showToast('Unsupported file type', 'error');
        continue;
      }

      const type = isVideo ? 'video' : 'image';
      const previewUrl = URL.createObjectURL(file);
      newMedia.push({ type, previewUrl, file, status: 'uploading', progress: 0, mediaKey: null, url: null });
    }

    if (newMedia.length > 0) {
      setMedia((prev) => [...prev, ...newMedia]);
      setIsExpanded(true);
      newMedia.forEach(m => startUpload(m.file, m.type, m.previewUrl));
    }
    
    e.target.value = '';
  };

  const retryUpload = (previewUrl) => {
    const m = media.find(x => x.previewUrl === previewUrl);
    if (!m?.file) return;
    setMedia((prev) => prev.map(x => x.previewUrl === previewUrl ? { ...x, status: 'uploading', error: null, progress: 0 } : x));
    startUpload(m.file, m.type, m.previewUrl);
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
    setIsExpanded(true);
    if (inputRef.current?.insertTextAtCursor) {
      inputRef.current.insertTextAtCursor(emoji);
    } else {
      setValue((v) => {
        const currentText = typeof v === 'string' ? v : (v?.text || '');
        const currentMentions = v?.mentions || [];
        return { text: currentText + emoji, mentions: currentMentions };
      });
      inputRef.current?.focus();
    }
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
        onClick={() => {
          if (!expandedState) setIsExpanded(true);
          inputRef.current?.focus();
        }}
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

          {media.length > 0 && (
            <div style={{ position: 'relative', width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <MediaGrid 
                media={media.map(m => ({ url: m.previewUrl, type: m.type }))} 
                onRemove={(idx) => removeMedia(media[idx].previewUrl)}
              />

              {media.some(m => m.status === 'uploading') && (
                <div style={{ padding: '12px 16px', background: 'var(--color-bg-subtle)', borderRadius: '8px', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ fontWeight: 600 }}>
                    Uploading {media.filter(m => m.status === 'ready').length} / {media.length} items...
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {media.map((m, idx) => (
                      <div key={idx} style={{ flex: 1, height: '4px', background: 'rgba(0,0,0,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                        {m.status === 'uploading' && <div style={{ width: `${m.progress}%`, height: '100%', background: 'var(--color-primary)', transition: 'width 0.2s' }} />}
                        {m.status === 'ready' && <div style={{ width: '100%', height: '100%', background: 'var(--color-success)' }} />}
                        {m.status === 'error' && <div style={{ width: '100%', height: '100%', background: 'var(--color-danger)' }} />}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {media.some(m => m.status === 'error') && (
                <div style={{ padding: '12px 16px', background: 'var(--color-danger-subtle)', color: 'var(--color-danger)', borderRadius: '8px', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Some uploads failed.</span>
                  <button 
                    onClick={() => media.forEach(m => { if (m.status === 'error') retryUpload(m.previewUrl); })}
                    style={{ background: 'transparent', color: 'inherit', border: '1px solid currentColor', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontWeight: 600 }}
                  >
                    Retry Failed
                  </button>
                </div>
              )}
            </div>
          )}

          <div className={styles.composerActions}>
            <div className={styles.composerActionsLeft}>
              <input ref={imageFileRef} type="file" accept={ALLOWED_IMAGE_ACCEPT} multiple onChange={(e) => handleFileChange(e, 'image')} hidden />
              <input ref={videoFileRef} type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" multiple onChange={(e) => handleFileChange(e, 'video')} hidden />
              <button 
                className={styles.composerIconBtn} 
                title={media.length >= 6 ? "Maximum 6 media items allowed" : "Image"} 
                onClick={() => imageFileRef.current?.click()}
                disabled={media.length >= 6}
                style={{ opacity: media.length >= 6 ? 0.5 : 1, cursor: media.length >= 6 ? 'not-allowed' : 'pointer' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                <span>Image</span>
              </button>
              <button 
                className={styles.composerIconBtn} 
                title={media.length >= 6 ? "Maximum 6 media items allowed" : "Video"} 
                onClick={() => videoFileRef.current?.click()}
                disabled={media.length >= 6}
                style={{ opacity: media.length >= 6 ? 0.5 : 1, cursor: media.length >= 6 ? 'not-allowed' : 'pointer' }}
              >
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
});

export default memo(PostComposer);

