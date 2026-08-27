import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Upload, Loader2, Plus } from '@shared/components/icons';
import Avatar from '@shared/components/avatar/Avatar';
import { useSignup } from '../../context/SignupContext';
import { useAuth } from '@shared/context/AuthContext';
import AnimatedStep from './AnimatedStep';
import AvatarPickerModal from './AvatarPickerModal';
import { processAndUploadImage } from '@shared/utils/mediaPipeline';
import { normalizeDicebearUrl } from '@shared/api/apiClient';
import { generateRandomAvatarSet } from '@shared/utils/dicebear';
import { showToast } from '@shared/utils/toast';
import { AuthHeading, AuthButton, styles as s } from '../../shared/ui';

export default function Step5Avatar() {
  const { signupData, updateData, clearSignupData } = useSignup();
  const { updateProfile } = useAuth();
  const navigate = useNavigate();

  const [avatar, setAvatar] = useState(signupData.avatar || '');
  const [isUploading, setIsUploading] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  // Generate a randomized set of only 5 quick avatars on initial step load
  const [quickAvatars] = useState(() => generateRandomAvatarSet(5));

  const getProcessedAvatarUrl = useCallback((url) => {
    if (!url || !url.includes('api.dicebear.com/')) return url;
    return normalizeDicebearUrl(url);
  }, []);

  const handleSelectAvatar = useCallback((url) => {
    setAvatar(url);
    updateData({ avatar: url });
  }, [updateData]);

  const handleClosePicker = useCallback(() => {
    setIsPickerOpen(false);
  }, []);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const MAX_FILE_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      showToast('File too large (max 50MB)', 'error');
      e.target.value = '';
      return;
    }

    setIsUploading(true);
    try {
      const { publicUrl } = await processAndUploadImage(file, 'avatars', { maxWidthOrHeight: 512 });
      handleSelectAvatar(publicUrl);
    } catch {
      showToast('Upload failed', 'error');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleFinish = async () => {
    const chosenAvatar = getProcessedAvatarUrl(avatar) || '';
    updateProfile({ avatar: chosenAvatar }).catch((err) => console.error('Avatar update error:', err));
    clearSignupData();
    navigate('/onboarding', { replace: true });
  };

  return (
    <AnimatedStep className={s.stepWrapper}>
      <AuthHeading title="Add a profile picture" />

      <div className={s.avatarStage}>
        <div className={s.avatarRing}>
          <div className={s.avatarCircle}>
            {isUploading ? (
              <Loader2 size={32} className={s.btnSpin} style={{ color: 'var(--color-text-muted)' }} />
            ) : (
              <Avatar src={avatar ? getProcessedAvatarUrl(avatar) : null} size="100%" />
            )}
          </div>
          <label className={s.avatarUpload} aria-label="Upload a profile picture">
            <Upload size={17} />
            <input type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
          </label>
        </div>

        <div className={s.presetWrap}>
          <span className={s.presetLabel}>Or choose a preset character</span>
          <div className={s.presetRow}>
            {quickAvatars.map((item) => {
              const processedUrl = getProcessedAvatarUrl(item.url);
              const isSelected = avatar === item.url || avatar === processedUrl;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectAvatar(item.url)}
                  className={`${s.presetBtn} ${isSelected ? s.presetBtnActive : ''}`}
                  aria-label={`Choose ${item.styleLabel} avatar`}
                  aria-pressed={isSelected}
                >
                  <img
                    src={processedUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                </button>
              );
            })}

            {/* "+" Button to open expanded avatar picker */}
            <button
              type="button"
              className={s.presetMoreBtn}
              onClick={() => setIsPickerOpen(true)}
              aria-label="Choose more avatars"
              title="More avatars"
            >
              <Plus size={20} />
            </button>
          </div>
        </div>

        <AuthButton
          onClick={handleFinish}
          loading={isUploading}
          loadingText="Uploading..."
          icon={<ArrowRight size={18} />}
        >
          {avatar ? 'Complete Registration' : 'Skip & Finish Setup'}
        </AuthButton>
      </div>

      {/* Expanded Avatar Picker Modal */}
      <AvatarPickerModal
        isOpen={isPickerOpen}
        onClose={handleClosePicker}
        selectedUrl={avatar}
        onSelect={handleSelectAvatar}
        forceLight={true}
      />
    </AnimatedStep>
  );
}
