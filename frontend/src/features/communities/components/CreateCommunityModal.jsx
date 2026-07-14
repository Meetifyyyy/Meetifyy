import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useData } from '@shared/context/DataContext';
import { showToast } from '@shared/utils/toast';
import styles from './CreateCommunityModal.module.css';

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

  // Export base64 cropped source from canvas
  const getCroppedAvatarUrl = () => {
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
        resolve(canvas.toDataURL('image/jpeg', 0.9));
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
        const croppedBase64 = await getCroppedAvatarUrl();
        if (croppedBase64) {
          finalAvatar = croppedBase64;
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
                <p className={styles.stepSubtitle}>Start with a name and a short description to help others discover and join your community.</p>
              </div>

              <div className={styles.fieldGroup}>
                <input
                  id="community-name-input"
                  ref={nameInputRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder=" "
                  maxLength={30}
                  className={styles.textInput}
                />
                <label htmlFor="community-name-input" className={styles.fieldLabel}>Community Name</label>
                <div className={styles.counterRow}>
                  <span>{name.length} / 30</span>
                </div>
              </div>

              <div className={styles.fieldGroup}>
                <textarea
                  id="community-desc-input"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder=" "
                  maxLength={250}
                  className={styles.textareaInput}
                />
                <label htmlFor="community-desc-input" className={styles.textareaLabel}>Description</label>
                <div className={styles.counterRow}>
                  <span>{desc.length} / 250</span>
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className={styles.stepTitleGroup}>
                <h3 className={styles.stepTitle}>Who can join your community?</h3>
                <p className={styles.stepSubtitle}>Choose who can become a member. You can change this later.</p>
              </div>

              <div className={styles.privacyContainer}>
                <div
                  onClick={() => setPrivacy('public')}
                  className={`${styles.privacyCard} ${privacy === 'public' ? styles.privacyCardSelected : ''}`}
                >
                  <span className={styles.privacyIcon}>🌍</span>
                  <div className={styles.privacyText}>
                    <span className={styles.privacyLabel}>Public</span>
                    <span className={styles.privacyDesc}>Anyone can discover and join your community instantly.</span>
                  </div>
                  <div className={styles.radioCircle}>
                    <div className={styles.radioDot} />
                  </div>
                </div>

                <div
                  onClick={() => setPrivacy('private')}
                  className={`${styles.privacyCard} ${privacy === 'private' ? styles.privacyCardSelected : ''}`}
                >
                  <span className={styles.privacyIcon}>🔒</span>
                  <div className={styles.privacyText}>
                    <span className={styles.privacyLabel}>Private</span>
                    <span className={styles.privacyDesc}>People must send a join request, and admins approve new members.</span>
                  </div>
                  <div className={styles.radioCircle}>
                    <div className={styles.radioDot} />
                  </div>
                </div>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <div className={styles.stepTitleGroup}>
                <h3 className={styles.stepTitle}>Choose a community avatar</h3>
                <p className={styles.stepSubtitle}>Upload an image or keep the auto-generated letter avatar.</p>
              </div>

              <div className={styles.avatarSection}>
                {avatarPreview ? (
                  <>
                    <div 
                      className={styles.avatarCropperContainer}
                      onTouchStart={handleDragStart}
                      onTouchMove={handleDragMove}
                      onTouchEnd={handleDragEnd}
                      onMouseDown={handleDragStart}
                      onMouseMove={handleDragMove}
                      onMouseUp={handleDragEnd}
                      onMouseLeave={handleDragEnd}
                    >
                      <div className={styles.cropperWrapper}>
                        <img
                          src={avatarPreview}
                          alt="Preview"
                          className={styles.cropperImage}
                          style={{
                            width: `${baseDimensions.w}px`,
                            height: `${baseDimensions.h}px`,
                            transform: `translate(calc(-50% + ${cropState.x}px), calc(-50% + ${cropState.y}px)) scale(${cropState.zoom})`
                          }}
                        />
                      </div>
                    </div>
                    <div className={styles.zoomSliderRow}>
                      <span className={styles.zoomIcon}>➖</span>
                      <input
                        type="range"
                        min="1"
                        max="3"
                        step="0.05"
                        value={cropState.zoom}
                        onChange={(e) => setCropState(prev => ({ ...prev, zoom: parseFloat(e.target.value) }))}
                        className={styles.zoomInput}
                      />
                      <span className={styles.zoomIcon}>➕</span>
                    </div>
                  </>
                ) : (
                  <div 
                    className={styles.letterAvatar}
                    style={{ background: gradient }}
                  >
                    {name.trim() ? name.trim().charAt(0).toUpperCase() : '?'}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={styles.uploadTriggerButton}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={styles.uploadTriggerIcon}>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <span>{avatarPreview ? 'Change avatar' : 'Upload avatar'}</span>
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileChange}
                  className={styles.avatarInput}
                />
              </div>
            </>
          )}
        </div>

        {/* Footer with dots and pill buttons */}
        <div className={styles.footer}>
          {/* Dot indicators progress */}
          <div className={styles.dotsProgress}>
            <div className={`${styles.dot} ${step === 1 ? styles.dotActive : ''}`} />
            <div className={`${styles.dot} ${step === 2 ? styles.dotActive : ''}`} />
            <div className={`${styles.dot} ${step === 3 ? styles.dotActive : ''}`} />
            <div className={`${styles.dot} ${step === 4 ? styles.dotActive : ''}`} />
          </div>

          <div className={styles.buttonGroup}>
            {step === 1 ? (
              <button type="button" onClick={onClose} className={styles.buttonCancel}>
                Cancel
              </button>
            ) : (
              <button type="button" onClick={() => setStep(prev => prev - 1)} className={styles.buttonBack}>
                Back
              </button>
            )}

            {step < 4 ? (
              <button
                type="button"
                onClick={handleContinue}
                disabled={step === 1 ? !isCategoryValid : !isStep2Valid}
                className={styles.buttonContinue}
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSubmit()}
                disabled={isSubmitting || !isCategoryValid || !isStep2Valid}
                className={styles.buttonCreate}
              >
                {isSubmitting ? 'Creating...' : 'Create'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
