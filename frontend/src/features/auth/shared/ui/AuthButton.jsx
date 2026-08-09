import React from 'react';
import { Loader2 } from 'lucide-react';
import s from './authKit.module.css';

/**
 * The primary auth action button, with a built-in loading state so every flow
 * shows progress identically.
 *
 * @param {boolean} [loading]
 * @param {string}  [loadingText]
 * @param {'primary'|'ghost'} [variant]
 * @param {React.ReactNode} [icon]  trailing icon shown when not loading
 */
export default function AuthButton({
  children,
  loading = false,
  loadingText,
  variant = 'primary',
  icon = null,
  disabled,
  className = '',
  ...rest
}) {
  const cls = [s.button, variant === 'ghost' ? s.buttonGhost : '', className].filter(Boolean).join(' ');

  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {loading ? (
        <>
          <Loader2 size={18} className={`${s.btnIcon} ${s.btnSpin}`} />
          {loadingText || children}
        </>
      ) : (
        <>
          {children}
          {icon ? <span className={s.btnIcon}>{icon}</span> : null}
        </>
      )}
    </button>
  );
}
