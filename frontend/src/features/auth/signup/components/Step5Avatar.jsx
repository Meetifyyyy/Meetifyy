import React, { useState } from 'react';
import { useSignup } from '../../context/SignupContext';
import { useAuth } from '@shared/context/AuthContext';
import { useTheme } from '@shared/context/ThemeContext';
import { useNavigate } from 'react-router-dom';
import AnimatedStep from './AnimatedStep';
import { motion } from 'framer-motion';
import { ArrowRight, Camera, Upload, Check, Loader2 } from 'lucide-react';
import styles from '../SignupFlow.module.css';
import defaultAvatarImg from '../../../../assets/images/default_avatar.png';

import { useR2Upload } from '@shared/hooks/useR2Upload';

const presetAvatars = [
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Felix',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Aneka',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Jack',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Precious',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Luna'
];

export default function Step5Avatar() {
  const { signupData, clearSignupData } = useSignup();
  const { updateProfile, currentUser } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const { upload: uploadToR2 } = useR2Upload('avatars');
  
  const [avatar, setAvatar] = useState(signupData.avatar || '');
  const [isUploading, setIsUploading] = useState(false);
  const bgHex = theme === 'dark' ? '202020' : 'ffffff';

  const getProcessedAvatarUrl = (url) => {
    if (!url || !url.startsWith('https://api.dicebear.com/')) return url;
    return url.split('&backgroundColor=')[0];
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const MAX_FILE_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      alert('File too large. Maximum size is 50 MB.');
      e.target.value = '';
      return;
    }

    setIsUploading(true);
    try {
      const publicUrl = await uploadToR2(file);
      setAvatar(publicUrl);
    } catch {
      alert('Upload failed. Try again.');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleFinish = async () => {
    const chosenAvatar = getProcessedAvatarUrl(avatar) || '';

    updateProfile({ avatar: chosenAvatar }).catch(err => console.error('Avatar update error:', err));
    
    // Clear persistence to prevent stale state for future signups
    clearSignupData();
    
    navigate('/onboarding');
  };

  return (
    <AnimatedStep className={styles.stepWrapper}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-primary)', marginBottom: '1rem' }}>
        <Camera size={24} />
        <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Profile Picture</span>
      </div>
      <h2 className={styles.headline}>Add a profile picture</h2>
      <p className={styles.subheadline}>Show your tribe who you are. You can always change this later.</p>

      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2rem' }}>
        {/* Avatar Display */}
        <div style={{ position: 'relative', width: '128px', height: '128px' }}>
          <div style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            overflow: 'hidden',
            background: 'var(--color-bg-alt)',
            border: '3px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--shadow-md)'
          }}>
            {isUploading ? (
              <Loader2 size={36} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
            ) : avatar ? (
              <img src={getProcessedAvatarUrl(avatar)} alt="Profile Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }}  onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.png'; }} />
            ) : (
              <img src={defaultAvatarImg} alt="Default Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }}  onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.png'; }} />
            )}
          </div>
          
          <label style={{
            position: 'absolute',
            bottom: '0',
            right: '0',
            background: 'var(--color-primary)',
            color: 'white',
            width: '38px',
            height: '38px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: 'var(--shadow-sm)',
            border: '2px solid var(--color-bg-white)'
          }}>
            <Upload size={18} />
            <input type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
          </label>
        </div>

        {/* Preset Avatars Selection */}
        <div style={{ width: '100%', textAlign: 'center' }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)', display: 'block', textAlign: 'center' }}>Or choose a preset character</span>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '0.75rem' }}>
            {presetAvatars.map((url, idx) => {
              const processedUrl = getProcessedAvatarUrl(url);
              const isSelected = avatar && avatar.split('&backgroundColor=')[0] === url;
              return (
                <button
                  key={idx}
                  onClick={() => setAvatar(url)}
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '50%',
                    overflow: 'hidden',
                    border: isSelected ? '3px solid var(--color-primary)' : '2px solid transparent',
                    background: 'var(--color-bg-alt)',
                    padding: 0,
                    cursor: 'pointer',
                    transform: isSelected ? 'scale(1.1)' : 'none',
                    transition: 'all 0.2s'
                  }}
                >
                  <img src={processedUrl} alt={`Preset ${idx}`} style={{ width: '100%', height: '100%' }} />
                </button>
              );
            })}
          </div>
        </div>

        <button 
          onClick={handleFinish}
          className={styles.continueBtn}
          style={{ width: '100%', justifyContent: 'center', marginTop: '1rem' }}
        >
          {avatar ? 'Complete Registration' : 'Skip & Finish Setup'} <ArrowRight className={styles.btnIcon} />
        </button>
      </div>
    </AnimatedStep>
  );
}

