import React from 'react';
import s from './authKit.module.css';

/** Title + subtitle block shown at the top of the form panel on every auth screen. */
export default function AuthHeading({ title, subtitle, className = '' }) {
  return (
    <div className={`${s.heading} ${className}`}>
      <h1 className={s.title}>{title}</h1>
      {subtitle ? <p className={s.subtitle}>{subtitle}</p> : null}
    </div>
  );
}
