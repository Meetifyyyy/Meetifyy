import React from 'react';
import { ArrowLeft } from 'lucide-react';
import s from './authKit.module.css';

/** A standalone back arrow for single-step screens (forgot/reset password) that don't need the full StepProgress rail. */
export default function BackButton({ onClick, label = 'Go back' }) {
  return (
    <button type="button" onClick={onClick} className={s.standaloneBack} aria-label={label}>
      <ArrowLeft size={17} />
    </button>
  );
}
