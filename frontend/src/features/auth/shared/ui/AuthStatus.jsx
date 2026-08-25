import React from 'react';
import s from './authKit.module.css';

/**
 * A centered result screen: icon badge + title + description + actions.
 * Used for the "check your email" / "link expired" / "password updated"
 * style states across the forgot/reset password flows.
 *
 * @param {React.ComponentType} [icon]  icon component from @shared/components/icons (omit for the loading tone, which shows a spinner instead)
 * @param {'success'|'error'|'loading'} [tone]
 */
export default function AuthStatus({ icon: Icon, tone = 'success', title, description, children }) {
  const toneClass = tone === 'error' ? s.toneError : tone === 'loading' ? s.toneLoading : s.toneSuccess;

  return (
    <div className={s.statusPanel}>
      <span className={`${s.statusIconWrap} ${toneClass}`}>
        {Icon ? <Icon size={28} strokeWidth={1.75} /> : <span className={s.spinner} />}
      </span>
      <h1 className={s.statusTitle}>{title}</h1>
      {description ? <p className={s.statusDesc}>{description}</p> : null}
      {children ? <div className={s.statusActions}>{children}</div> : null}
    </div>
  );
}
