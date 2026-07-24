import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';

import { showToast } from '@shared/utils/toast';
import styles from './CreateCommunityModal.module.css';
import { useData } from '@shared/hooks/useData';
import { useR2Upload } from '@shared/hooks/useR2Upload';

const colors26 = [
  'linear-gradient(135deg, #FF6B6B, #FF8E53)',
  'linear-gradient(135deg, #4E65FF, #92EFFD)',
  'linear-gradient(135deg, #11998e, #38ef7d)',
  'linear-gradient(135deg, #FC466B, #3F5EFB)',
  'linear-gradient(135deg, #7F00FF, #E100FF)',
  'linear-gradient(135deg, #ff007f, #ff00ff)',
  'linear-gradient(135deg, #00c6ff, #0072ff)',
  'linear-gradient(135deg, #f857a6, #ff5858)',
  'linear-gradient(135deg, #eb3c5a, #f67280)',
  'linear-gradient(135deg, #56ab2f, #a8e063)',
  'linear-gradient(135deg, #F3904F, #3B4371)',
  'linear-gradient(135deg, #30CFD0, #330867)',
  'linear-gradient(135deg, #ee9ca7, #ffdde1)',
  'linear-gradient(135deg, #C33764, #1D2671)',
  'linear-gradient(135deg, #0f2027, #203a43)',
  'linear-gradient(135deg, #3a7bd5, #3a6073)',
  'linear-gradient(135deg, #1cd8d2, #93edc7)',
  'linear-gradient(135deg, #4ca1af, #c4e0e5)',
  'linear-gradient(135deg, #2c3e50, #bdc3c7)',
  'linear-gradient(135deg, #f4c4f3, #fc67fa)',
  'linear-gradient(135deg, #e65c00, #F9D423)',
  'linear-gradient(135deg, #2193b0, #6dd5ed)',
  'linear-gradient(135deg, #cc2b5e, #753a88)',
  'linear-gradient(135deg, #ec008c, #fc6767)',
  'linear-gradient(135deg, #1488C8, #2B32B2)',
  'linear-gradient(135deg, #e96443, #904e95)'
];

const categories = [
  { id: 'coding', label: 'Technology', icon: '💻' },
  { id: 'coding', label: 'Programming', icon: '👨‍💻' },
  { id: 'ai', label: 'Artificial Intelligence', icon: '🤖' },
  { id: 'design', label: 'Design', icon: '🎨' },
  { id: 'art', label: 'Art', icon: '🖌️' },
  { id: 'startup', label: 'Business & Startups', icon: '💼' },
  { id: 'science', label: 'Science', icon: '🔬' },
  { id: 'coding', label: 'Engineering', icon: '⚙️' },
  { id: 'education', label: 'Academics', icon: '📚' },
  { id: 'career', label: 'Career', icon: '💼' },
  { id: 'gaming', label: 'Gaming', icon: '🎮' },
  { id: 'other', label: 'Anime & Manga', icon: '🌸' },
  { id: 'other', label: 'Memes & Humor', icon: '😂' },
  { id: 'music', label: 'Music', icon: '🎵' },
  { id: 'photography', label: 'Photography', icon: '📸' },
  { id: 'photography', label: 'Videography', icon: '🎥' },
  { id: 'film', label: 'Movies & TV', icon: '🎬' },
  { id: 'sports', label: 'Sports', icon: '⚽' },
  { id: 'health', label: 'Fitness', icon: '💪' },
  { id: 'travel', label: 'Travel', icon: '✈️' },
  { id: 'food', label: 'Food', icon: '🍕' },
  { id: 'fashion', label: 'Fashion', icon: '👗' },
  { id: 'books', label: 'Books & Literature', icon: '📖' },
  { id: 'pets', label: 'Pets & Animals', icon: '🐶' },
  { id: 'other', label: 'Volunteering', icon: '🤝' },
  { id: 'education', label: 'Campus Life', icon: '🎓' },
  { id: 'startup', label: 'Entrepreneurship', icon: '🚀' },
  { id: 'other', label: 'Content Creation', icon: '🎥' },
  { id: 'language', label: 'Languages', icon: '🌍' },
  { id: 'health', label: 'Health & Wellness', icon: '🩺' },
  { id: 'other', label: 'Lifestyle', icon: '🌿' },
  { id: 'other', label: 'Other', icon: '✨' }
];

export default function CreateCommunityModal({ onClose, onCreated }) {
  const { addCommunity } = useData();
  const { upload: uploadCommunityIcon } = useR2Upload('community-icons');

  // Wizard Steps state
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [selectedCat, setSelectedCat] = useState(null);
  const [privacy, setPrivacy] = useState('public');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Avatar crop & upload state
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [avatarFile, setAvatarFile] = useState(null);
  const [cropState, setCropState] = useState({ x: 0, y: 0, zoom: 1 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [dragStart, setDragStart] = useState(null);

  // Fixed gradient background for letter avatar fallback
  const [gradient] = useState(() => colors26[Math.floor(Math.random() * colors26.length)]);

  const fileInputRef = useRef(null);
  const nameInputRef = useRef(null);

  // Auto-focus name input when step 2 is active
  useEffect(() => {
    if (step === 2 && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [step]);

  // Validations
  const isCategoryValid = useMemo(() => {
    return selectedCat !== null;
  }, [selectedCat]);

  const isNameValid = useMemo(() => {
    const trimmed = name.trim();
    if (trimmed.length < 3 || trimmed.length > 30) return false;
    const regex = /^[a-zA-Z0-9\s.,!?'"()-]+$/;
    return regex.test(trimmed);
  }, [name]);

  const isDescValid = useMemo(() => {
    const trimmed = desc.trim();
    return trimmed.length >= 3 && trimmed.length <= 250;
  }, [desc]);

  const isStep2Valid = useMemo(() => {
    return isNameValid && isDescValid;
  }, [isNameValid, isDescValid]);

  // Handle file inputs
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      showToast('Supported formats: JPG, PNG, WEBP');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showToast('File size must be under 5 MB');
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setAvatarFile(file);
    setAvatarPreview(previewUrl);
    setCropState({ x: 0, y: 0, zoom: 1 });

    const img = new Image();
    img.src = previewUrl;
    img.onload = () => {
      setImageSize({ width: img.width, height: img.height });
    };
  };

  // Drag logic for custom cropper
  const handleDragStart = (e) => {
    e.preventDefault();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    setDragStart({ x: clientX - cropState.x, y: clientY - cropState.y });
  };

  const handleDragMove = (e) => {
    if (!dragStart) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    let newX = clientX - dragStart.x;
    let newY = clientY - dragStart.y;
    
    const limit = 120 * cropState.zoom;
    if (Math.abs(newX) > limit) newX = Math.sign(newX) * limit;
    if (Math.abs(newY) > limit) newY = Math.sign(newY) * limit;

    setCropState(prev => ({
      ...prev,
      x: newX,
      y: newY
    }));
  };

  const handleDragEnd = () => {
    setDragStart(null);
  };

  const baseDimensions = useMemo(() => {
    if (!imageSize.width || !imageSize.height) return { w: 150, h: 150 };
    const aspect = imageSize.width / imageSize.height;
    if (aspect > 1) {
      return { w: 150 * aspect, h: 150 };
    } else {
      return { w: 150, h: 150 / aspect };
    }
  }, [imageSize]);

  // Export File Blob from canvas
  const getCroppedAvatarFile = () => {
    return new Promise((resolve) => {
      if (!avatarPreview) {
        resolve(null);
        return;
      }

      const img = new Image();
      img.src = avatarPreview;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, 256, 256);

        const scaleFactor = 256 / 150;
        const targetW = baseDimensions.w * cropState.zoom * scaleFactor;
        const targetH = baseDimensions.h * cropState.zoom * scaleFactor;
        const targetX = 128 + cropState.x * scaleFactor - targetW / 2;
        const targetY = 128 + cropState.y * scaleFactor - targetH / 2;

        ctx.drawImage(img, targetX, targetY, targetW, targetH);
        canvas.toBlob((blob) => {
          if (!blob) {
            resolve(null);
            return;
          }
          const file = new File([blob], 'community-avatar.jpg', { type: 'image/jpeg' });
          resolve(file);
        }, 'image/jpeg', 0.9);
      };
      img.onerror = () => {
        resolve(null);
      };
    });
  };

  // Submit and create community
  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!isCategoryValid || !isStep2Valid) return;

    setIsSubmitting(true);
    try {
      let finalAvatar = name.trim().charAt(0).toUpperCase();
      let hasCustomAvatar = false;

      if (avatarPreview) {
        const croppedFile = await getCroppedAvatarFile();
        if (croppedFile) {
          finalAvatar = await uploadCommunityIcon(croppedFile);
          hasCustomAvatar = true;
        }
      }

      const id = await addCommunity({
        name: name.trim(),
        desc: desc.trim(),
        avatar: finalAvatar,
        color: gradient,
        categoryLabel: `${selectedCat.icon} ${selectedCat.label}`,
        categories: [selectedCat.id],
        privacy: privacy,
        hasCustomAvatar
      });

      showToast('Community created!');
      onCreated(id);
    } catch (err) {
      showToast('Failed to create community');
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Continue wizard navigation
  const handleContinue = () => {
    if (step === 1 && isCategoryValid) {
      setStep(2);
    } else if (step === 2 && isStep2Valid) {
      setStep(3);
    } else if (step === 3) {
      setStep(4);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (step < 4) {
        handleContinue();
      } else if (step === 4 && isCategoryValid && isStep2Valid && !isSubmitting) {
        handleSubmit();
      }
    }
  };

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Absolute-positioned Close Button */}
        <button onClick={onClose} className={styles.closeButton} aria-label="Close modal">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Steps Body */}
        <div className={styles.stepWrapper}>
          {step === 1 && (
            <>
              <div className={styles.stepTitleGroup}>
                <h3 className={styles.stepTitle}>What will your community be about?</h3>
                <p className={styles.stepSubtitle}>Choose a topic to help people discover your community.</p>
              </div>

              <div className={styles.fieldGroup}>
                <div className={styles.categoryGrid}>
                  {categories.map((cat, idx) => {
                    const isSelected = selectedCat?.label === cat.label;
                    return (
                      <button
                        key={`${cat.label}-${idx}`}
                        type="button"
                        onClick={() => setSelectedCat(cat)}
                        className={`${styles.categoryCard} ${isSelected ? styles.categoryCardSelected : ''}`}
                      >
                        {isSelected && <span style={{ marginRight: '0.25rem', fontWeight: 'bold' }}>✓</span>}
                        <span>{cat.icon}</span>
                        <span>{cat.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className={styles.stepTitleGroup}>
                <h3 className={styles.stepTitle}>Create your community</h3>
                <p className={styles.stepSubtitle}>Choose a name and description that clearly explains your community.</p>
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Name</label>
                <div className={styles.inputWrap}>
                  <input
                    ref={nameInputRef}
                    type="text"
                    placeholder="e.g. Design Enthusiasts"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    maxLength={30}
                    className={styles.textInput}
                  />
                  <span className={styles.charCounter}>{name.length}/30</span>
                </div>
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Description</label>
                <div className={styles.inputWrap}>
                  <textarea
                    placeholder="What is this community about?"
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    rows={3}
                    maxLength={250}
                    className={styles.textArea}
                  />
                  <span className={styles.charCounter}>{desc.length}/250</span>
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className={styles.stepTitleGroup}>
                <h3 className={styles.stepTitle}>Set an icon for your community</h3>
                <p className={styles.stepSubtitle}>Upload an image or keep the default gradient icon.</p>
              </div>

              <div className={styles.fieldGroup} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />

                {!avatarPreview ? (
                  <div
                    className={styles.avatarPreviewPlaceholder}
                    style={{ background: gradient }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <span className={styles.avatarPreviewLetter}>
                      {name.trim() ? name.trim().charAt(0).toUpperCase() : '?'}
                    </span>
                    <div className={styles.avatarPreviewOverlay}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                        <circle cx="12" cy="13" r="4" />
                      </svg>
                    </div>
                  </div>
                ) : (
                  <div className={styles.cropperContainer}>
                    <div
                      className={styles.cropWindow}
                      onMouseDown={handleDragStart}
                      onMouseMove={handleDragMove}
                      onMouseUp={handleDragEnd}
                      onMouseLeave={handleDragEnd}
                      onTouchStart={handleDragStart}
                      onTouchMove={handleDragMove}
                      onTouchEnd={handleDragEnd}
                    >
                      <img
                        src={avatarPreview}
                        alt="Crop preview"
                        className={styles.cropImg}
                        style={{
                          width: `${baseDimensions.w}px`,
                          height: `${baseDimensions.h}px`,
                          transform: `translate(${cropState.x}px, ${cropState.y}px) scale(${cropState.zoom})`
                        }}
                       onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.png'; }} />
                    </div>
                    <div className={styles.cropControls}>
                      <label className={styles.zoomLabel}>Zoom</label>
                      <input
                        type="range"
                        min="1"
                        max="3"
                        step="0.05"
                        value={cropState.zoom}
                        onChange={(e) => setCropState(prev => ({ ...prev, zoom: parseFloat(e.target.value) }))}
                        className={styles.zoomRange}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setAvatarPreview(null);
                          setAvatarFile(null);
                        }}
                        className={styles.removePhotoBtn}
                      >
                        Remove photo
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <div className={styles.stepTitleGroup}>
                <h3 className={styles.stepTitle}>Who can join?</h3>
                <p className={styles.stepSubtitle}>Choose privacy settings for your community.</p>
              </div>

              <div className={styles.privacyOptions}>
                <button
                  type="button"
                  onClick={() => setPrivacy('public')}
                  className={`${styles.privacyCard} ${privacy === 'public' ? styles.privacyCardSelected : ''}`}
                >
                  <div className={styles.privacyIcon}>🌐</div>
                  <div className={styles.privacyDetails}>
                    <div className={styles.privacyName}>Public</div>
                    <div className={styles.privacyDesc}>Anyone can view and join this community.</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setPrivacy('private')}
                  className={`${styles.privacyCard} ${privacy === 'private' ? styles.privacyCardSelected : ''}`}
                >
                  <div className={styles.privacyIcon}>🔒</div>
                  <div className={styles.privacyDetails}>
                    <div className={styles.privacyName}>Private</div>
                    <div className={styles.privacyDesc}>Only approved members can view posts and join.</div>
                  </div>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Footer Navigation */}
        <div className={styles.footer}>
          {step > 1 ? (
            <button type="button" onClick={() => setStep(step - 1)} className={styles.backBtn}>
              Back
            </button>
          ) : (
            <div />
          )}

          {step < 4 ? (
            <button
              type="button"
              onClick={handleContinue}
              disabled={step === 1 ? !isCategoryValid : !isStep2Valid}
              className={styles.continueBtn}
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className={styles.submitBtn}
            >
              {isSubmitting ? 'Creating...' : 'Create Community'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
