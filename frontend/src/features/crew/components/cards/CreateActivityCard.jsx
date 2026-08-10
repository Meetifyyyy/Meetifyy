import React from 'react';
import createActivityBackgroundCharacter from '@assets/images/createactivitybackgroundcharacter.webp';
import styles from './CreateActivityCard.module.css';

export default function CreateActivityCard({ onCreateActivity, className = '' }) {
  return (
    <div className={`${styles.createCard} ${className}`}>
      {/* Background Slash */}
      <div className={styles.blackSlash}>
        <svg viewBox="0 0 200 300" width="100%" height="100%" preserveAspectRatio="none">
          <path d="M120 0 L200 0 L200 300 L60 300 Z" fill="#000000" />
        </svg>
      </div>

      {/* Character Illustration */}
      <img 
        src={createActivityBackgroundCharacter} 
        alt="Creator Character" 
        className={styles.characterImg} 
      />

      <div className={styles.createCardContent}>
        <div className={styles.createCardTitle}>
          CREATE<br />
          ACTIVITY<span className={styles.yellowDot}>.</span>
        </div>
        <p className={styles.createCardSubtitle}>
          Create your activity in minutes, invite your crew, and start the fun.
        </p>
      </div>

      {/* Bottom Pill Button */}
      <div className={styles.createCardBottom}>
        <button 
          type="button"
          className={styles.createCardBtn} 
          onClick={onCreateActivity} 
          aria-label="Create Activity"
        >
          <div className={styles.createCardBtnIcon}>
            <span className={styles.btnAsterisk}>*</span>
          </div>
          <span className={styles.createCardBtnText}>CREATE ACTIVITY</span>
          <span className={styles.createCardBtnArrow}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </span>
        </button>
      </div>
    </div>
  );
}
