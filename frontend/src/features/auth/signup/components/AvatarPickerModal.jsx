import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, RefreshCw, Check, Upload } from '@shared/components/icons';
import {
  SUPPORTED_DICEBEAR_STYLES,
  DICEBEAR_STYLE_LABELS,
  generateAvatarCollection,
  generateCategoryAvatars,
} from '@shared/utils/dicebear';
import s from '../../shared/ui/authKit.module.css';

export default function AvatarPickerModal({
  isOpen,
  onClose,
  selectedUrl,
  onSelect,
  onUpload,
  forceLight = false,
}) {
  const [activeTab, setActiveTab] = useState('all');
  const [tempSelected, setTempSelected] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const prevOpenRef = useRef(false);

  // Tab cache: stores avatars generated per category tab to avoid re-fetching
  const [tabAvatars, setTabAvatars] = useState({});

  // When modal opens (transition from closed to open), initialize cleanly
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      setTempSelected('');
      setIsClosing(false);

      // Lazily populate current active tab if empty
      setTabAvatars((prev) => {
        if (prev[activeTab] && prev[activeTab].length > 0) return prev;
        const initialBatch =
          activeTab === 'all'
            ? generateAvatarCollection(8) // 8 per style = 48 mixed avatars
            : generateCategoryAvatars(activeTab, 20); // 20 avatars for specific style
        return {
          ...prev,
          [activeTab]: initialBatch,
        };
      });
    }
    prevOpenRef.current = isOpen;
  }, [isOpen, activeTab, selectedUrl]);

  // When tab changes, load only that category if not already cached
  const handleTabChange = useCallback((newTab) => {
    setActiveTab(newTab);
    setTabAvatars((prev) => {
      if (prev[newTab] && prev[newTab].length > 0) return prev;
      const batch =
        newTab === 'all'
          ? generateAvatarCollection(8)
          : generateCategoryAvatars(newTab, 20);
      return {
        ...prev,
        [newTab]: batch,
      };
    });
  }, []);

  // Smooth close helper with exit animation
  const handleClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 340);
  }, [isClosing, onClose]);

  // Confirm selection
  const handleConfirmSelect = () => {
    if (!tempSelected) return;
    onSelect(tempSelected);
    handleClose();
  };

  const handleUploadClick = () => {
    handleClose();
    if (typeof onUpload === 'function') {
      onUpload();
    }
  };

  // Regenerate only the active tab's batch
  const handleRefresh = useCallback(() => {
    const freshBatch =
      activeTab === 'all'
        ? generateAvatarCollection(8)
        : generateCategoryAvatars(activeTab, 20);

    setTabAvatars((prev) => ({
      ...prev,
      [activeTab]: freshBatch,
    }));
  }, [activeTab]);

  // Handle ESC key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  // Current visible avatars for active tab
  const currentAvatars = useMemo(() => {
    return tabAvatars[activeTab] || [];
  }, [tabAvatars, activeTab]);

  if (!isOpen && !isClosing) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`${s.avatarModalOverlay} ${isClosing ? s.avatarModalOverlayClosing : ''} ${forceLight ? s.forceLightMode : ''}`}
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="avatar-picker-title"
    >
      <div
        className={`${s.avatarModalCard} ${isClosing ? s.avatarModalCardClosing : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.avatarModalHandle} />

        {/* Header */}
        <div className={s.avatarModalHeader}>
          <h3 id="avatar-picker-title" className={s.avatarModalTitle}>
            Choose an Avatar
          </h3>
          <button
            type="button"
            className={s.avatarModalClose}
            onClick={handleClose}
            aria-label="Close modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Style Category Tabs */}
        <div className={s.avatarModalTabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'all'}
            className={`${s.avatarTabBtn} ${activeTab === 'all' ? s.avatarTabBtnActive : ''}`}
            onClick={() => handleTabChange('all')}
          >
            All
          </button>
          {SUPPORTED_DICEBEAR_STYLES.map((styleKey) => (
            <button
              key={styleKey}
              type="button"
              role="tab"
              aria-selected={activeTab === styleKey}
              className={`${s.avatarTabBtn} ${activeTab === styleKey ? s.avatarTabBtnActive : ''}`}
              onClick={() => handleTabChange(styleKey)}
            >
              {DICEBEAR_STYLE_LABELS[styleKey] || styleKey}
            </button>
          ))}
        </div>

        {/* Avatar Grid */}
        <div className={s.avatarModalBody}>
          <div className={s.avatarModalGrid}>
            {currentAvatars.map((item) => {
              const isSelected = tempSelected === item.url;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`${s.avatarGridItem} ${isSelected ? s.avatarGridItemActive : ''}`}
                  onClick={() => setTempSelected(item.url)}
                  aria-label={`Select ${item.styleLabel} avatar`}
                  aria-pressed={isSelected}
                >
                  <div className={s.avatarGridImgCircle}>
                    <img
                      src={item.url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  {isSelected && (
                    <span className={s.avatarGridCheck}>
                      <Check size={12} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className={s.avatarModalFooter}>
          <div className={s.avatarModalFooterLeft}>
            <button
              type="button"
              className={s.avatarRefreshBtn}
              onClick={handleRefresh}
              aria-label="Generate new avatars"
              title="Generate new avatars"
            >
              <RefreshCw size={18} />
            </button>

            {typeof onUpload === 'function' && (
              <button
                type="button"
                className={s.avatarUploadModalBtn}
                onClick={handleUploadClick}
                aria-label="Upload custom photo"
                title="Upload custom photo"
              >
                <Upload size={16} />
                <span>Upload</span>
              </button>
            )}
          </div>

          <button
            type="button"
            className={s.avatarSelectBtn}
            onClick={handleConfirmSelect}
            disabled={!tempSelected}
          >
            <span>Select</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
