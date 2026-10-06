import { IS_MOBILE_BUILD } from '@config';
import { useState, useRef, useEffect, useMemo, memo, forwardRef, useImperativeHandle } from 'react';
import LazyEmojiPicker from '@shared/components/ui/LazyEmojiPicker';
import { useAuth } from '@shared/context/AuthContext';
import Avatar from '@shared/components/avatar/Avatar';
import MentionInput from '@shared/components/mentions/MentionInput';
import MediaGrid from '../post/MediaGrid';
import styles from './PostComposer.module.css';
import { processAndUploadImage, processAndUploadVideo } from '@shared/utils/mediaPipeline';
import { uploadsApi } from '@shared/api/apiClient';
import { showToast } from '@shared/utils/toast';
import { useSmoothHeight } from '@shared/hooks/useSmoothHeight';
import { normalizeBodyText } from '@shared/utils/bodyText';
import { ALLOWED_IMAGE_ACCEPT } from '@shared/constants/mediaLimits';

/** Matches the expand transition in PostComposer.module.css (220ms) plus a frame. */
const EXPAND_MS = 240;


/**
 * The longest a single poll option may be. Mirrored by POLL_OPTION_MAX_LENGTH
 * in posts.service.ts, which is where it is actually enforced — `maxLength`
 * only stops typing, not a crafted request.
 *
 * Named because the limit appeared as a literal in five places here (the input
 * cap, the truncation in updatePollOption, the truncation on submit, the
 * counter's arithmetic and its tooltip), which is how the counter came to be
 * keyed to a different number than the cap it counts down to.
 */
const POLL_OPTION_MAX_LENGTH = 100;

/**
 * Most photos and videos one post may carry. The API refuses more
 * (`@ArrayMaxSize(6)` on CreatePostDto.mediaKeys); this is the same number,
 * enforced before anything is uploaded.
 */
export const MAX_POST_MEDIA = 6;
const LIMIT_NOTICE_MS = 6000;

/** The warning for a pick that went over the limit, or null when it did not. */
export function mediaLimitNotice({ selected, added, attachedBefore }) {
  if (selected <= added) return null;
  if (added === 0) {
    return attachedBefore >= MAX_POST_MEDIA
      ? `You've already added ${MAX_POST_MEDIA} photos and videos, the most a post can have. Remove one to add another.`
      : `A post can have up to ${MAX_POST_MEDIA} photos and videos.`;
  }
  return `Only ${added} of the ${selected} you selected ${added === 1 ? 'was' : 'were'} added. A post can have up to ${MAX_POST_MEDIA} photos and videos.`;
}

/**
 * The counter appears in the last stretch of the limit and turns amber nearer
 * the end. Both are expressed as characters remaining so they stay meaningful
 * if the cap changes; keyed to the length, they silently stopped matching it.
 */
const POLL_OPTION_COUNT_VISIBLE_AT = 30;
const POLL_OPTION_COUNT_WARNING_AT = 10;

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
  const [limitNotice, setLimitNotice] = useState(null);
  const { outerRef: mediaOuterRef, innerRef: mediaInnerRef } = useSmoothHeight();
  /*
   * The attachment count as of the latest pick, updated synchronously. `media`
   * is a render behind: two picks in quick succession (or a second picker
   * opened before the first one's files rendered) both saw the old length and
   * together went past the limit.
   */
  const mediaCountRef = useRef(0);
  useEffect(() => { mediaCountRef.current = media.length; }, [media.length]);

  // The warning clears itself, and whenever the count drops back under the limit.
  useEffect(() => {
    if (!limitNotice) return undefined;
    const t = setTimeout(() => setLimitNotice(null), LIMIT_NOTICE_MS);
    return () => clearTimeout(t);
  }, [limitNotice]);
  useEffect(() => {
    if (media.length < MAX_POST_MEDIA) setLimitNotice((n) => (n && n.startsWith("You've already") ? null : n));
  }, [media.length]);

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
        // The browser must not also scroll to the field while the keyboard moves.
        inputRef.current.focus({ preventScroll: true });
        // 'nearest', instant: a smooth centre-scroll ran against the keyboard
        // resizing the viewport and left the composer off-centre anyway.
        composerRef.current?.scrollIntoView?.({ block: 'nearest' });
      }
    }
  }), []);

  // Maps of previewUrl -> AbortController/Promise
  const uploadAbortRefs = useRef(new Map());
  const uploadPromiseRefs = useRef(new Map());

  // Abort any in-flight upload on unmount + revoke preview URLs
  useEffect(() => {
    const abortControllers = uploadAbortRefs.current;
    return () => {
      abortControllers.forEach(controller => controller.abort());
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
    // Only while there is something to close: a collapsed, empty composer
    // does not need to inspect every tap on the page.
    if (!isExpanded && !showEmoji) return undefined;
    // mousedown, NOT pointerdown. On a phone, pointerdown also fires when a
    // finger lands to start a scroll, so the composer collapsed mid-scroll and
    // the page jumped under the finger. A touch only produces mousedown for a
    // real tap, which is the only thing that should close it.
    document.addEventListener('mousedown', handler, { passive: true });
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmoji, hasContent, isExpanded]);

  // Back dismisses the keyboard without blurring the field, and mousedown (above)
  // never fires, so an empty composer would stay open with no keyboard. Treat the
  // keyboard closing as the end of the interaction.
  useEffect(() => {
    const onKeyboardHidden = () => {
      if (hasContent) return;
      // Only when the TEXT field is what has focus. Tapping Photo/Video/Poll
      // moves focus to that button and hides the keyboard on the way, and the
      // composer must stay open for what it is about to do (a file picker).
      const active = document.activeElement;
      if (!active || !composerRef.current?.contains(active) || !active.isContentEditable) return;
      active.blur();
      setIsExpanded(false);
    };
    window.addEventListener('meetifyy:keyboard-hidden', onKeyboardHidden);
    return () => window.removeEventListener('meetifyy:keyboard-hidden', onKeyboardHidden);
  }, [hasContent]);

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
        const opts = pollOptions
          .map((o) => o.trim().slice(0, POLL_OPTION_MAX_LENGTH))
          .filter(Boolean);
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

  const isMediaFull = media.length >= MAX_POST_MEDIA;

  /** Opens a picker, or explains why not when the post is already full. */
  const openPicker = (inputRef) => {
    if (mediaCountRef.current >= MAX_POST_MEDIA) {
      setLimitNotice(mediaLimitNotice({ selected: 1, added: 0, attachedBefore: mediaCountRef.current }));
      return;
    }
    setLimitNotice(null);
    inputRef.current?.click();
  };

  const handleFileChange = (e, expectedType) => {
    const files = Array.from(e.target.files || []);
    // Reset now: the same file can be picked again after it is removed.
    e.target.value = '';
    if (!files.length) return;

    const MAX_FILE_SIZE = 50 * 1024 * 1024;
    const valid = [];
    for (const file of files) {
      const isVideo = file.type.startsWith('video/');
      const isImage = file.type.startsWith('image/');
      if (file.size > MAX_FILE_SIZE) {
        showToast('File size limit is 50MB', 'error');
      } else if (expectedType === 'image' && !isImage) {
        showToast('Please select an image file.', 'error');
      } else if (expectedType === 'video' && !isVideo) {
        showToast('Please select a video file.', 'error');
      } else if (!isVideo && !isImage) {
        showToast('Unsupported file type', 'error');
      } else {
        valid.push({ file, type: isVideo ? 'video' : 'image' });
      }
    }
    if (!valid.length) return;

    // Neither the browser's nor Android's picker can be told a maximum, so the
    // limit is applied to what comes back: the first files that fit are kept,
    // in the order picked, and the rest are refused with a reason.
    const attachedBefore = mediaCountRef.current;
    const accepted = valid.slice(0, Math.max(0, MAX_POST_MEDIA - attachedBefore));
    mediaCountRef.current = attachedBefore + accepted.length;
    setLimitNotice(mediaLimitNotice({ selected: valid.length, added: accepted.length, attachedBefore }));
    if (!accepted.length) return;

    const newMedia = accepted.map(({ file, type }) => ({
      type, previewUrl: URL.createObjectURL(file), file, status: 'uploading', progress: 0, mediaKey: null, url: null,
    }));
    setMedia((prev) => [...prev, ...newMedia]);
    setIsExpanded(true);
    newMedia.forEach((m) => startUpload(m.file, m.type, m.previewUrl));
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
    next[idx] = val.slice(0, POLL_OPTION_MAX_LENGTH);
    setPollOptions(next);
  };

  const expandedState = isExpanded || hasContent;

  // Expand first, THEN raise the keyboard. A tap focuses the field at once (so
  // the caret is there), but with inputmode="none" no keyboard comes up; once
  // the composer has finished opening the mode is switched to text, and the
  // keyboard slides in over an already-settled layout instead of resizing the
  // window in the middle of the expand animation.
  // The app only: on the website (and iOS, where a keyboard can be raised only
  // from inside the tap itself) the field takes focus normally.
  const [keyboardReady, setKeyboardReady] = useState(!IS_MOBILE_BUILD);
  useEffect(() => {
    if (!IS_MOBILE_BUILD) return undefined;
    if (!expandedState) {
      setKeyboardReady(false);
      return undefined;
    }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(() => setKeyboardReady(true), reduced ? 0 : EXPAND_MS);
    return () => clearTimeout(t);
  }, [expandedState]);

  // The mode switch alone does not make Android raise the keyboard for a field
  // that already has focus, so ask for it once the composer has settled.
  useEffect(() => {
    if (!IS_MOBILE_BUILD || !keyboardReady) return;
    const el = document.activeElement;
    if (
      el && composerRef.current?.contains(el) && el.isContentEditable &&
      !document.documentElement.hasAttribute('data-keyboard-open')
    ) {
      el.blur();
      // The platform focus, not the editor's own override, which moves the caret
      // to the end and would discard where the user already put it.
      HTMLElement.prototype.focus.call(el, { preventScroll: true });
    }
  }, [keyboardReady]);

  // A new array on every render made MediaGrid redo its URL resolution on each
  // keystroke and each upload-progress tick. Only url/type matter to it.
  const gridKey = media.map((m) => `${m.previewUrl}|${m.type}`).join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const gridMedia = useMemo(() => media.map((m) => ({ url: m.previewUrl, type: m.type })), [gridKey]);

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
        onClick={(e) => {
          if (!expandedState) setIsExpanded(true);
          // Clicking the composer's empty area focuses the text field. But this
          // handler sits on the element that WRAPS the poll editor, so a click
          // into a poll option bubbled up here and had focus yanked straight
          // back to the main editor — which made the option fields impossible
          // to type into: every keystroke landed in the post text instead.
          //
          // Anything the browser can focus on its own is left alone; the
          // convenience only applies to the inert areas that have no focus
          // behaviour of their own.
          if (
            e.target.closest(
              'input, textarea, select, button, a, label, [contenteditable]',
            )
          ) {
            return;
          }
          inputRef.current?.focus({ preventScroll: true });
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
              inputMode={keyboardReady ? undefined : 'none'}
              onSubmit={() => { if (!showPoll) handlePost(); }}
              singleLine={false}
            />
          </div>
          <button
            ref={emojiBtnRef}
            className={`${styles.composerEmojiBtn}${showEmoji ? ` ${styles.active}` : ''}${expandedState ? '' : ` ${styles.composerEmojiBtnHidden}`}`}
            tabIndex={expandedState ? 0 : -1}
            aria-hidden={!expandedState}
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
        </div>

        <div
          className={`${styles.composerExpandContainer}${expandedState ? ` ${styles.expanded}` : ''}`}
          aria-hidden={!expandedState}
          inert={expandedState ? undefined : ''}
        >
          <div className={styles.composerExpandClip}>
          <div className={styles.composerExpandInner}>
          {showPoll && (
            <div className={styles.inlinePollCreator}>
              <div className={styles.pollOptionsList}>
                {pollOptions.map((opt, i) => {
                  const isLast = i === pollOptions.length - 1;
                  const hasAdd = isLast && pollOptions.length < 5;
                  const hasDelete = pollOptions.length > 2;
                  const remaining = POLL_OPTION_MAX_LENGTH - opt.length;
                  const showCount = remaining <= POLL_OPTION_COUNT_VISIBLE_AT;

                  return (
                    <div key={i} className={styles.pollOptionRow}>
                      <div className={styles.pollOptionInputWrapper}>
                        <input
                          className={styles.pollOptionInput}
                          type="text"
                          placeholder={`Option ${i + 1}`}
                          value={opt}
                          maxLength={POLL_OPTION_MAX_LENGTH}
                          onChange={(e) => updatePollOption(i, e.target.value)}
                          style={{
                            paddingRight: hasDelete
                              ? (showCount ? '3.6rem' : '2.2rem')
                              : (showCount ? '2.4rem' : '0.75rem'),
                          }}
                        />
                        {showCount && (
                          <span
                            className={`${styles.pollOptionCharCount}${hasDelete ? ` ${styles.hasDelete}` : ''}${remaining === 0 ? ` ${styles.limit}` : remaining <= POLL_OPTION_COUNT_WARNING_AT ? ` ${styles.warning}` : ''}`}
                            title={`${remaining} characters remaining (max ${POLL_OPTION_MAX_LENGTH})`}
                          >
                            {remaining}
                          </span>
                        )}
                        {hasDelete && (
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

          {/* Always mounted, so adding the first attachment and removing the
              last one animate too; see useSmoothHeight. */}
          <div ref={mediaOuterRef}>
            <div ref={mediaInnerRef}>
              {media.length > 0 && (
              <div style={{ position: 'relative', width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <MediaGrid 
                  media={gridMedia}
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
            </div>
          </div>

          {/*
            * Inline rather than a toast: on a phone a toast can sit behind the
            * keyboard or the bottom bar, and this is about the composer the
            * person is looking at. role="alert" reads it out as it appears.
            */}
          {limitNotice && (
            <div className={styles.mediaLimitNotice} role="alert">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{limitNotice}</span>
              <button type="button" className={styles.mediaLimitDismiss} aria-label="Dismiss" onClick={() => setLimitNotice(null)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          )}

          <div className={styles.composerActions}>
            <div className={styles.composerActionsLeft}>
              <input ref={imageFileRef} type="file" accept={ALLOWED_IMAGE_ACCEPT} multiple onChange={(e) => handleFileChange(e, 'image')} hidden />
              <input ref={videoFileRef} type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" multiple onChange={(e) => handleFileChange(e, 'video')} hidden />
              <button 
                className={styles.composerIconBtn} 
                title={isMediaFull ? `Maximum ${MAX_POST_MEDIA} photos and videos` : "Image"}
                aria-label="Add image"
                onClick={() => openPicker(imageFileRef)}
                aria-disabled={isMediaFull}
              >
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="5.5" />
                  <circle cx="9" cy="9" r="1.75" />
                  <path d="M21 15.5l-3.6-3.6a2 2 0 0 0-2.8 0L6 20.5" />
                </svg>
                <span className={styles.composerBtnLabel}>Image</span>
              </button>
              <button 
                className={styles.composerIconBtn} 
                title={isMediaFull ? `Maximum ${MAX_POST_MEDIA} photos and videos` : "Video"}
                aria-label="Add video"
                onClick={() => openPicker(videoFileRef)}
                aria-disabled={isMediaFull}
              >
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="2.5" y="5.5" width="14" height="13" rx="4" />
                  <path d="M16.5 10.2l3.6-2.3a1 1 0 0 1 1.4.9v6.4a1 1 0 0 1-1.4.9l-3.6-2.3" />
                </svg>
                <span className={styles.composerBtnLabel}>Video</span>
              </button>

              <button
                ref={pollBtnRef}
                className={`${styles.composerIconBtn}${showPoll ? ` ${styles.active}` : ''}`}
                title="Poll"
                aria-label={showPoll ? 'Remove poll' : 'Add poll'}
                aria-pressed={showPoll}
                onClick={togglePoll}
              >
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="5.5" />
                  <path d="M8.5 16v-4" />
                  <path d="M12 16V8" />
                  <path d="M15.5 16v-2.5" />
                </svg>
                <span className={styles.composerBtnLabel}>Poll</span>
              </button>

              {media.length > 0 && (
                <span
                  className={`${styles.mediaCount} ${isMediaFull ? styles.mediaCountFull : ''}`}
                  aria-label={`${media.length} of ${MAX_POST_MEDIA} photos and videos added`}
                >
                  {media.length}/{MAX_POST_MEDIA}
                </span>
              )}
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
                <span>Post</span>
              )}
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  </div>
  );
});

export default memo(PostComposer);

