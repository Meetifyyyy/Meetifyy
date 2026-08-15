import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Upload, Loader2 } from 'lucide-react';
import { useSignup } from '../../context/SignupContext';
import { useAuth } from '@shared/context/AuthContext';
import AnimatedStep from './AnimatedStep';
import { processAndUploadImage } from '@shared/utils/mediaPipeline';
import { normalizeDicebearUrl } from '@shared/api/apiClient';
import { showToast } from '@shared/utils/toast';
import { AuthHeading, AuthButton, styles as s } from '../../shared/ui';
import defaultAvatarImg from '../../../../assets/images/default_avatar.webp';

const presetAvatars = [
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Felix',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Aneka',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Jack',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Precious',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Luna',
];

export default function Step5Avatar() {
  const { signupData, clearSignupData } = useSignup();
  const { updateProfile } = useAuth();
  const navigate = useNavigate();

  const [avatar, setAvatar] = useState(signupData.avatar || '');
  const [isUploading, setIsUploading] = useState(false);

  const getProcessedAvatarUrl = (url) => {
    if (!url || !url.includes('api.dicebear.com/')) return url;
    return normalizeDicebearUrl(url);
  };

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
      setAvatar(publicUrl);
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
              <img
                src={avatar ? getProcessedAvatarUrl(avatar) : defaultAvatarImg}
                alt="Profile preview"
                onError={(e) => {
                  e.target.onerror = null;
                  e.target.src = defaultAvatarImg;
                }}
              />
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
            {presetAvatars.map((url) => {
              const processedUrl = getProcessedAvatarUrl(url);
              const isSelected = avatar && avatar.split('&backgroundColor=')[0] === url;
              return (
                <button
                  key={url}
                  type="button"
                  onClick={() => setAvatar(url)}
                  className={`${s.presetBtn} ${isSelected ? s.presetBtnActive : ''}`}
                  aria-label="Choose preset avatar"
                  aria-pressed={isSelected}
                >
                  <img src={processedUrl} alt="" />
                </button>
              );
            })}
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
    </AnimatedStep>
  );
}
