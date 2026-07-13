import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, Camera, RefreshCw } from 'lucide-react';
import { GROUP_NAME_MIN_LENGTH, GROUP_NAME_MAX_LENGTH, GROUP_DESC_MAX_LENGTH } from '../../constants/group';
import styles from './GroupCreationModal.module.css';

export default function GroupCreationModal({ onClose, onCreate, isDark = true }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [avatar, setAvatar] = useState(null);
  
  // Crop / Preview states
  const [cropSrc, setCropSrc] = useState(null);
  const [showCropModal, setShowCropModal] = useState(false);
  const [zoom, setZoom] = useState(1);

  // Status states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const fileInputRef = useRef(null);

  const handleAvatarClick = () => {
    if (isSubmitting || showSuccess) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setCropSrc(event.target.result);
        setShowCropModal(true);
        setZoom(1);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const handleSaveCrop = () => {
    // Save preview
    setAvatar(cropSrc);
    setShowCropModal(false);
  };

  const handleSubmit = async () => {
    if (name.trim().length < GROUP_NAME_MIN_LENGTH || name.trim().length > GROUP_NAME_MAX_LENGTH) return;
    if (desc.trim().length > GROUP_DESC_MAX_LENGTH) return;

    setIsSubmitting(true);
    setError(null);
    setUploadProgress(10);

    try {
      // Simulate image upload progress if avatar is selected
      if (avatar) {
        for (let p = 20; p <= 100; p += 20) {
          await new Promise(resolve => setTimeout(resolve, 80));
          setUploadProgress(p);
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      await onCreate(name.trim(), desc.trim(), avatar);
      
      setUploadProgress(null);
      setShowSuccess(true);
      
      // Wait for success animation
      await new Promise(resolve => setTimeout(resolve, 1000));
      onClose();
    } catch (err) {
      setError(err?.message || 'Failed to create group. Please try again.');
      setIsSubmitting(false);
      setUploadProgress(null);
    }
  };

  const isValid = name.trim().length >= GROUP_NAME_MIN_LENGTH && 
                  name.trim().length <= GROUP_NAME_MAX_LENGTH && 
                  desc.trim().length <= GROUP_DESC_MAX_LENGTH;

  return createPortal(
    <div className={`${styles.overlay} ${isDark ? styles.darkTheme : styles.lightTheme}`} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <button onClick={onClose} className={styles.iconBtn} title="Back">
            <ArrowLeft size={20} />
          </button>
          <h3 className={styles.title}>Create Group</h3>
          <button 
            onClick={handleSubmit} 
            className={`${styles.iconBtn} ${styles.tickBtn}`} 
            disabled={!isValid || isSubmitting || showSuccess}
            title="Create"
          >
            {isSubmitting ? (
              <RefreshCw size={20} className={styles.spin} />
            ) : (
              <Check size={20} />
            )}
          </button>
        </div>

        {/* Modal body */}
        <div className={styles.body}>
          {showSuccess ? (
            <div className={styles.successContainer}>
              <div className={styles.successBadge}>
                <Check size={48} />
              </div>
              <h4>Group Created!</h4>
            </div>
          ) : (
            <>
              {error && (
                <div className={styles.errorBanner}>
                  <span>{error}</span>
                  <button className={styles.retryBtn} onClick={handleSubmit}>Retry</button>
                </div>
              )}

              {/* Avatar Section */}
              <div className={styles.avatarContainer}>
                <input 
                  type="file" 
                  accept="image/*" 
                  ref={fileInputRef} 
                  style={{ display: 'none' }} 
                  onChange={handleFileChange} 
                />
                <div className={styles.avatarPicker} onClick={handleAvatarClick}>
                  {avatar ? (
                    <img src={avatar} alt="Preview" className={styles.avatarImg} />
                  ) : (
                    <div className={styles.avatarPlaceholder}>
                      <Camera size={28} />
                      <span className={styles.placeholderText}>Set avatar (optional)</span>
                    </div>
                  )}
                  {uploadProgress !== null && (
                    <div className={styles.progressOverlay}>
                      <div className={styles.progressBar} style={{ width: `${uploadProgress}%` }}></div>
                    </div>
                  )}
                </div>
              </div>

              {/* Inputs */}
              <div className={styles.formGroup}>
                <input 
                  id="group-name-input"
                  type="text" 
                  value={name} 
                  onChange={(e) => setName(e.target.value)} 
                  placeholder=" "
                  maxLength={GROUP_NAME_MAX_LENGTH}
                  className={styles.input}
                  disabled={isSubmitting}
                  autoFocus
                />
                <label htmlFor="group-name-input" className={styles.label}>Group Name</label>
                <div className={styles.counter}>
                  {name.length}/{GROUP_NAME_MAX_LENGTH}
                </div>
              </div>

              <div className={styles.formGroup}>
                <textarea 
                  id="group-desc-input"
                  value={desc} 
                  onChange={(e) => setDesc(e.target.value)} 
                  placeholder=" "
                  maxLength={GROUP_DESC_MAX_LENGTH}
                  className={styles.textarea}
                  disabled={isSubmitting}
                  rows={3}
                />
                <label htmlFor="group-desc-input" className={styles.label}>Description (Optional)</label>
                <div className={styles.counter}>
                  {desc.length}/{GROUP_DESC_MAX_LENGTH}
                </div>
              </div>

              <div className={styles.footerNote}>
                This group will be discoverable by anyone with an email address from your campus.
              </div>
            </>
          )}
        </div>
      </div>

      {/* Crop / Preview Submodal */}
      {showCropModal && (
        <div className={styles.cropOverlay} onClick={() => setShowCropModal(false)}>
          <div className={styles.cropModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.cropHeader}>
              <h4>Edit Media</h4>
              <button className={styles.cropClose} onClick={() => setShowCropModal(false)}>Cancel</button>
            </div>
            <div className={styles.cropBody}>
              <div className={styles.cropFrame}>
                <img 
                  src={cropSrc} 
                  alt="Crop Preview" 
                  className={styles.cropImg} 
                  style={{ transform: `scale(${zoom})` }}
                />
              </div>
              <div className={styles.zoomControl}>
                <span className={styles.zoomLabel}>Zoom</span>
                <input 
                  type="range" 
                  min="1" 
                  max="3" 
                  step="0.1" 
                  value={zoom} 
                  onChange={(e) => setZoom(parseFloat(e.target.value))} 
                  className={styles.zoomSlider}
                />
              </div>
            </div>
            <div className={styles.cropFooter}>
              <button className={styles.saveCropBtn} onClick={handleSaveCrop}>Crop & Save</button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
