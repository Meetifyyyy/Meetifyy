import { Loader2 } from '@shared/components/icons';
import s from './authKit.module.css';

/**
 * The primary auth action button, with a built-in loading state so every flow
 * shows progress identically.
 *
 * Loading does not swap the label for other text. The label and the spinner
 * are both always rendered, stacked in the same box: pressing the button
 * slides the label up and out while the spinner rises into its place, and the
 * reverse when loading ends. Nothing about the button's size depends on which
 * one is showing, so it cannot change width or jump. `loadingText` is no
 * longer painted; it is announced to screen readers instead.
 *
 * @param {boolean} [loading]
 * @param {string}  [loadingText]  spoken while loading (visually a spinner)
 * @param {'primary'|'ghost'} [variant]
 * @param {React.ReactNode} [icon]  trailing icon beside the label
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
  const cls = [s.button, variant === 'ghost' ? s.buttonGhost : '', loading ? s.buttonLoading : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      <span className={s.btnLabel} aria-hidden={loading || undefined}>
        {children}
        {icon ? <span className={s.btnIcon}>{icon}</span> : null}
      </span>
      <span className={s.btnSpinner} aria-hidden="true">
        <Loader2 size={20} className={s.btnSpin} />
      </span>
      {loading ? <span className={s.srOnly}>{loadingText || 'Loading'}</span> : null}
    </button>
  );
}
