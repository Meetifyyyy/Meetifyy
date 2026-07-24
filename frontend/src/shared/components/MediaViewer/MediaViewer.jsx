import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useMediaViewer } from '@shared/context/MediaViewerContext';
import { isImageUrl } from '@shared/utils/avatar';
import { showToast } from '@shared/utils/toast';
import ImageViewer from './ImageViewer';
import VideoViewer from './VideoViewer';
import styles from './MediaViewer.module.css';
import SharePostModal from '@features/feed/components/modals/SharePostModal';
import { isSafeUrl } from '@shared/utils/urlSanitize';
import ReportModal from '@shared/components/modals/ReportModal/ReportModal';

/** Detect video items by explicit type field OR URL extension. */
function isVideo(item) {
  if (!item) return false;
  // Explicit type always wins
  if (item.type === 'video') return true;
  if (item.type === 'image') return false;
  // Fallback: sniff by URL
  const u = (item.url || '').toLowerCase().split('?')[0]; // strip query params
  return u.endsWith('.mp4') || u.endsWith('.webm') || u.endsWith('.ogg') ||
         u.endsWith('.mov') || u.endsWith('.avi') || u.endsWith('.mkv') ||
         u.startsWith('data:video');
}

export default function MediaViewer() {
  const { state, closeViewer, navigate, savedScrollRef } = useMediaViewer();
  const { open, items, index, meta } = state;

  const overlayRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [savedUrls, setSavedUrls] = useState(() => new Set());
  const [showReportModal, setShowReportModal] = useState(false);
  const [hasReported, setHasReported] = useState(false);
  const didClose = useRef(false);

  const currentItem = items[index] || null;
  const prevItem = items[index - 1] || null;
  const nextItem = items[index + 1] || null;

  // Derived here so effects can reference it
  const isVid = isVideo(currentItem);

  // ── Open / close animation ──
  useEffect(() => {
    if (open) {
      didClose.current = false;
      setControlsVisible(true);
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [open]);

  // Restore scroll after close animation
  useEffect(() => {
    if (!open && !didClose.current) {
      didClose.current = true;
      const timer = setTimeout(() => {
        window.scrollTo(0, savedScrollRef.current || 0);
      }, 320);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // ── Keyboard navigation ──
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === 'Escape') { handleClose(); return; }
      // When a video is open, let VideoViewer own arrow keys and media keys
      if (isVid) return;
      if (e.key === 'ArrowLeft') navigate(-1);
      if (e.key === 'ArrowRight') navigate(1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, navigate, isVid]);

  // ── Focus trap ──
  useEffect(() => {
    if (open) overlayRef.current?.focus();
  }, [open]);

  const handleClose = useCallback(() => {
    setVisible(false);
    setTimeout(closeViewer, 280);
  }, [closeViewer]);

  const toggleControls = useCallback(() => {
    setControlsVisible(v => !v);
    setShowMoreMenu(false);
  }, []);

  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) handleClose();
  };

  const handleDownload = async () => {
    const url = currentItem?.url;
    if (!url) return;
    showToast('Downloading…');
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = url.split('/').pop()?.split('?')[0] || 'media';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (_) {
      if (!isSafeUrl(url)) return;
      const a = document.createElement('a');
      a.href = url;
      a.download = url.split('/').pop()?.split('?')[0] || 'media';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const handleShare = async () => {
    if (meta?.source === 'Post' && meta?.post) {
      setShowShareModal(true);
      return;
    }
    const url = currentItem?.url;
    if (!url) return;
    try {
      if (navigator.share) {
        await navigator.share({ url });
      } else {
        await navigator.clipboard?.writeText(url);
        showToast('Link copied');
      }
    } catch (_) {}
  };

  const handleSave = () => {
    if (!currentItem?.url) return;
    setSavedUrls(prev => {
      const next = new Set(prev);
      if (next.has(currentItem.url)) next.delete(currentItem.url);
      else next.add(currentItem.url);
      return next;
    });
    setShowMoreMenu(false);
  };

  if (!open) return null;

  const hasMany = items.length > 1;
  const fromPost = meta?.source === 'Post' && !isVid;

  return createPortal(
    <div
      ref={overlayRef}
      className={`${styles.overlay} ${visible ? styles.visible : ''}`}
      onClick={handleOverlayClick}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
    >
      {/* ── Counter badge ── */}
      {hasMany && (
        <div className={`${styles.counterBadge} ${controlsVisible ? styles.controlsVisible : ''}`}>
          {index + 1} / {items.length}
        </div>
      )}

      {/* ── Top bar ── */}
      <div className={`${styles.topBar} ${controlsVisible ? styles.controlsVisible : ''}`}>
        <div className={styles.topBarLeft}>
          <button className={styles.iconBtn} onClick={handleClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.topBarRight}>
          {/* Forward */}
          {meta?.source !== 'Post' && (
            <button className={styles.iconBtn} onClick={() => showToast('Forwarded!')} aria-label="Forward">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 17 20 12 15 7" />
                <path d="M4 18v-2a4 4 0 0 1 4-4h12" />
              </svg>
            </button>
          )}

          {/* Share */}
          <button className={styles.iconBtn} onClick={handleShare} aria-label="Share">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          </button>

          {/* More menu */}
          <div className={styles.moreMenuWrap}>
            <button
              className={styles.iconBtn}
              onClick={(e) => { e.stopPropagation(); setShowMoreMenu(!showMoreMenu); }}
              aria-label="More options"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2.2" /><circle cx="12" cy="12" r="2.2" /><circle cx="12" cy="19" r="2.2" />
              </svg>
            </button>
            <div className={`${styles.moreMenu} ${showMoreMenu ? styles.open : ''}`} onClick={(e) => e.stopPropagation()}>
              <button className={styles.moreMenuItem} onClick={() => { handleDownload(); setShowMoreMenu(false); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                Download
              </button>
              <button className={styles.moreMenuItem} onClick={handleSave}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill={currentItem?.url && savedUrls.has(currentItem.url) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                {currentItem?.url && savedUrls.has(currentItem.url) ? 'Saved' : 'Save'}
              </button>
              <button
                className={styles.moreMenuItem}
                onClick={() => {
                  setShowMoreMenu(false);
                  if (!hasReported) setShowReportModal(true);
                }}
                disabled={hasReported}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></svg>
                {hasReported ? 'Already Reported' : 'Report'}
              </button>
              {meta?.isOwner && (
                <button className={`${styles.moreMenuItem} ${styles.danger}`} onClick={() => { showToast('Deleted'); handleClose(); setShowMoreMenu(false); }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Media stage ── */}
      <div className={styles.stage}>
        {currentItem?.url && (isVid ? (
          <VideoViewer
            key={currentItem.url}
            src={currentItem.url}
            onControlsChange={setControlsVisible}
          />
        ) : (
          <ImageViewer
            key={currentItem.url}
            src={currentItem.url}
            onToggleControls={toggleControls}
            preloadNext={nextItem?.url}
            preloadPrev={prevItem?.url}
          />
        ))}
      </div>

      {/* ── Nav buttons ── */}
      {hasMany && (
        <>
          <button
            className={`${styles.navBtn} ${styles.navPrev} ${controlsVisible ? styles.controlsVisible : ''}`}
            onClick={(e) => { e.stopPropagation(); navigate(-1); }}
            disabled={index === 0}
            aria-label="Previous"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            className={`${styles.navBtn} ${styles.navNext} ${controlsVisible ? styles.controlsVisible : ''}`}
            onClick={(e) => { e.stopPropagation(); navigate(1); }}
            disabled={index === items.length - 1}
            aria-label="Next"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </>
      )}

      {/* ── Info panel ── */}
      {meta && (
        <div className={`${styles.infoPanel} ${fromPost ? styles.infoPanelStandalone : ''} ${controlsVisible ? styles.controlsVisible : ''}`}>
          {meta.authorAvatar && isImageUrl(meta.authorAvatar) ? (
            <img src={meta.authorAvatar} alt={meta.authorName} className={styles.infoAvatar}  onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.png'; }} />
          ) : (
            <div className={styles.infoAvatarPlaceholder}>
              {(meta.authorName || 'U').charAt(0).toUpperCase()}
            </div>
          )}
          <div className={styles.infoText}>
            <div className={styles.infoAuthor}>{meta.authorName || 'Unknown'}</div>
            <div className={styles.infoMeta}>
              {meta.timestamp}{meta.source ? ` · ${meta.source}` : ''}
            </div>
            {currentItem?.caption && (
              <div className={styles.infoCaption}>{currentItem.caption}</div>
            )}
          </div>
        </div>
      )}

      {showShareModal && meta?.post && (
        <SharePostModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          post={meta.post}
          author={meta.author}
        />
      )}

      <ReportModal
        isOpen={showReportModal}
        onClose={() => setShowReportModal(false)}
        targetType={meta?.postId ? 'POST' : (meta?.author?.id ? 'USER' : 'POST')}
        targetId={meta?.postId || meta?.author?.id || currentItem?.url || 'media'}
        targetName={meta?.author?.name || meta?.author?.username}
        targetAvatar={meta?.author?.avatar}
        targetPreview={currentItem?.caption || meta?.post?.text?.slice(0, 80)}
        reportedFrom="media-viewer"
        onSubmitted={() => setHasReported(true)}
      />

    </div>,
    document.body
  );
}
