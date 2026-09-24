import { useState, useCallback } from 'react';
import { ArrowRight, Upload, Loader2, Plus } from '@shared/components/icons';
import Avatar from '@shared/components/avatar/Avatar';
import { useSignup } from '../../context/SignupContext';
import AnimatedStep from './AnimatedStep';
import AvatarPickerModal from './AvatarPickerModal';
import { processAndUploadImage } from '@shared/utils/mediaPipeline';
import {
  MAX_COVERED_IMAGE_SIZE_BYTES,
  COVERED_IMAGE_SIZE_ERROR_MESSAGE,
  ALLOWED_IMAGE_ACCEPT,
} from '@shared/constants/mediaLimits';
import { normalizeDicebearUrl } from '@shared/api/apiClient';
import { generateRandomAvatarSet } from '@shared/utils/dicebear';
import { showToast } from '@shared/utils/toast';
import { AuthHeading, AuthButton, styles as s } from '../../shared/ui';

/**
 * Step 6 — an optional photo. Required information is all behind us by now,
 * so this screen says so: a primary action once something is picked, and a
 * plain "Skip for now" that is always there. Either one hands off to the
 * finishing screen (SignupFinishing), which completes the account.
 */
export default function Step6Photo() {
  const { signupData, updateData, setFinishing } = useSignup();

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

    if (file.size > MAX_COVERED_IMAGE_SIZE_BYTES) {
      showToast(COVERED_IMAGE_SIZE_ERROR_MESSAGE, 'error');
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

  const finish = (chosen) => {
    setFinishing({ avatar: getProcessedAvatarUrl(chosen) || '' });
  };

  return (
    <AnimatedStep className={s.stepWrapper}>
      <AuthHeading title="Add a profile photo" subtitle="Optional. A face or a character helps people recognise you." />

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
            <input type="file" accept={ALLOWED_IMAGE_ACCEPT} onChange={handleFileChange} style={{ display: 'none' }} />
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

        <div className={s.photoActions}>
          <AuthButton
            onClick={() => finish(avatar)}
            loading={isUploading}
            loadingText="Uploading..."
            disabled={!avatar}
            icon={<ArrowRight size={18} />}
          >
            Finish
          </AuthButton>
          <button
            type="button"
            className={s.skipBtn}
            onClick={() => finish('')}
            disabled={isUploading}
          >
            Skip for now
          </button>
        </div>
      </div>

      {/* Expanded Avatar Picker Modal */}
      <AvatarPickerModal
        isOpen={isPickerOpen}
        onClose={handleClosePicker}
        selectedUrl={avatar}
        onSelect={handleSelectAvatar}
      />
    </AnimatedStep>
  );
}
