import { memo, useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import CoverImage from '@shared/components/ui/CoverImage';
import Avatar from '@shared/components/avatar/Avatar';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { ALLOWED_IMAGE_ACCEPT } from '@shared/constants/mediaLimits';
import {
  COVER_GRADIENTS,
  COVER_PATTERNS,
  isSameCover,
  selectable,
} from '@shared/lib/covers/profileCovers';
import { useExpandableCoverSheet } from './useExpandableCoverSheet';
import styles from './CoverEditorSheet.module.css';

const PATTERNS = selectable(COVER_PATTERNS);
const GRADIENTS = selectable(COVER_GRADIENTS);

/**
 * One design in the grid. Memoised and keyed on `selected` alone, so moving the
 * selection repaints two tiles, not the whole grid.
 */
const Tile = memo(function Tile({ design, selected, onPick }) {
  return (
    <button
      type="button"
      className={styles.tile}
      style={{ background: design.css }}
      aria-pressed={selected}
      aria-label={design.label}
      title={design.label}
      onClick={() => onPick(design.css)}
    />
  );
});

/**
 * Edit cover: patterns, gradients or a photo.
 *
 * A pattern or gradient is a draft until Save: the preview at the top shows it
 * on a miniature of the profile, and closing the sheet by any route (drag,
 * backdrop, Back, the close button) discards it. A photo goes straight to the
 * cropper, whose confirm is its own Save. Upload sits beside Save in the
 * footer, so both actions stay in reach while the grid scrolls.
 *
 * On phones the sheet opens at its usual height and grows to full screen as
 * the grid is scrolled or the header dragged up (useExpandableCoverSheet).
 *
 * `cover` is what the profile shows now, including an upload still in flight;
 * `upload` is that upload's progress (0-100) or null.
 */
export default function CoverEditorSheet({ isOpen, onClose, cover, avatar, name, upload, onSave, onPhoto }) {
  useOverlayBack(Boolean(isOpen), onClose);
  useScrollLock(Boolean(isOpen));
  const { sheetRef, headerRef, bodyRef, footerRef } = useExpandableCoverSheet(onClose, { enabled: Boolean(isOpen) });
  const fileRef = useRef(null);

  // Mounted per opening (ProfilePage renders it only while open), so each
  // opening starts from what the profile shows and a discarded draft is gone.
  const [draft, setDraft] = useState(cover);

  const pick = useCallback((css) => setDraft(css), []);
  const uploading = upload != null;
  const dirty = Boolean(draft) && draft !== cover;

  if (!isOpen) return null;

  const save = () => {
    if (!dirty) return;
    onSave(draft);
  };

  const onFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    // A cancelled picker hands back no file; nothing to do.
    if (file) onPhoto(file);
  };

  const grid = (designs, label) => (
    <div className={styles.grid} role="group" aria-label={label}>
      {designs.map((d) => (
        <Tile key={d.id} design={d} selected={isSameCover(draft, d)} onPick={pick} />
      ))}
    </div>
  );

  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cover-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div ref={headerRef} className={styles.header}>
          <div className="sheet-handle" data-sheet-handle aria-hidden="true" />
          <div className={styles.headerRow}>
            <h2 id="cover-sheet-title" className={styles.title}>Edit cover</h2>
            <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div ref={bodyRef} className={styles.body}>
          {/* Roughly the profile: the cover, with the avatar over its lower edge. */}
          <div className={styles.preview} aria-hidden="true">
            <CoverImage cover={draft} className={styles.previewCover} />
            <div className={styles.previewAvatar}>
              <Avatar src={avatar} name={name} size="52px" />
            </div>
          </div>

          <h3 className={styles.sectionLabel}>Patterns</h3>
          {grid(PATTERNS, 'Patterns')}

          <h3 className={styles.sectionLabel}>Gradients</h3>
          {grid(GRADIENTS, 'Gradients')}
        </div>

        <div ref={footerRef} className={styles.footer}>
          <input ref={fileRef} type="file" accept={ALLOWED_IMAGE_ACCEPT} hidden onChange={onFile} />
          <button
            type="button"
            className={styles.uploadBtn}
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
            {uploading ? `Uploading… ${Math.round(upload)}%` : 'Upload'}
          </button>
          <button type="button" className={styles.saveBtn} onClick={save} disabled={!dirty}>
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
