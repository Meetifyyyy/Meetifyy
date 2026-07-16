import React, { useState } from 'react';
import { useSignup } from '../SignupContext';
import { useAuth } from '@shared/context/AuthContext';
import { useNavigate } from 'react-router-dom';
import AnimatedStep from './AnimatedStep';
import { motion } from 'framer-motion';
import { ArrowRight, Camera, Upload, Check, Loader2 } from 'lucide-react';
import styles from '../SignupFlow.module.css';

const presetAvatars = [
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Felix',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Aneka',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Jack',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Precious',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Luna'
];

export default function Step5Avatar() {
  const { signupData, updateData } = useSignup();
  const { signup } = useAuth();
  const navigate = useNavigate();

  const [avatar, setAvatar] = useState(signupData.avatar || '');
  const [isUploading, setIsUploading] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);

  const loadingMessages = [
    'Creating your profile...',
    'Finding students near you...',
    'Matching interests...',
    'Setting up your campus circle...',
    'Almost ready!'
  ];

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsUploading(true);
    const reader = new FileReader();
    reader.onloadend = () => {
      setAvatar(reader.result);
      setIsUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const handleFinish = () => {
    setIsFinishing(true);

    const interval = setInterval(() => {
      setLoadingMsgIdx((prev) => (prev < loadingMessages.length - 1 ? prev + 1 : prev));
    }, 800);

    setTimeout(() => {
      clearInterval(interval);
      const mockUsername = signupData.username || `user${Math.floor(Math.random() * 1000)}`;
      
      const finalData = {
        ...signupData,
        username: mockUsername,
        avatar: avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${signupData.firstName || 'U'}`
      };

      signup(finalData);
      navigate('/home');
    }, 4000);
  };

  if (isFinishing) {
    return (
      <AnimatedStep className={styles.stepWrapper} style={{ alignItems: 'center', textAlign: 'center', padding: '4rem 0' }}>
        <div style={{ position: 'relative', marginBottom: '2.5rem' }}>
          <motion.div
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              border: '4px solid var(--color-border)',
              borderTopColor: 'var(--color-primary)',
              display: 'inline-block',
            }}
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
          />
        </div>
        <h2 className={styles.headline}>Preparing your dashboard...</h2>
        <p className={styles.subheadline} style={{ marginTop: '0.5rem', color: 'var(--color-primary)', fontWeight: 600 }}>
          {loadingMessages[loadingMsgIdx]}
        </p>
      </AnimatedStep>
    );
  }

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
              <img src={avatar} alt="Profile Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ fontSize: '3rem', fontWeight: 700, color: 'var(--color-text-light)' }}>
                {(signupData.firstName || 'U')[0].toUpperCase()}
              </span>
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
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>Or choose a preset character</span>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '0.75rem' }}>
            {presetAvatars.map((url, idx) => (
              <button
                key={idx}
                onClick={() => setAvatar(url)}
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  overflow: 'hidden',
                  border: avatar === url ? '3px solid var(--color-primary)' : '2px solid transparent',
                  background: 'var(--color-bg-alt)',
                  padding: 0,
                  cursor: 'pointer',
                  transform: avatar === url ? 'scale(1.1)' : 'none',
                  transition: 'all 0.2s'
                }}
              >
                <img src={url} alt={`Preset ${idx}`} style={{ width: '100%', height: '100%' }} />
              </button>
            ))}
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
