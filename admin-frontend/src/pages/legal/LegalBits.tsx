import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from '../../components/icons';
import type { AcceptanceStats } from './legalApi';
import { acceptancePercent, formatCount } from './legalFormat';

/** "412 of 1,030 users accepted", with a bar. */
export const AcceptanceBar: React.FC<{ stats: AcceptanceStats }> = ({ stats }) => {
  const pct = acceptancePercent(stats);
  return (
    <div className="legal-progress">
      <div className="legal-progress-label">
        <span>
          <strong>{formatCount(stats.acknowledged)}</strong> of{' '}
          {formatCount(stats.totalActiveUsers)} users accepted
        </span>
        <span>{pct}%</span>
      </div>
      <div
        className="legal-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Users who accepted this version"
      >
        <div className="legal-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

/** The document as the public page renders it. Content is server-sanitized. */
export const DocumentPreview: React.FC<{
  title: string;
  subtitle?: string | null;
  html: string;
}> = ({ title, subtitle, html }) => (
  <article className="legal-doc">
    <h1 className="legal-doc-title">{title || 'Untitled'}</h1>
    {subtitle && <p className="legal-doc-subtitle">{subtitle}</p>}
    <div className="legal-doc-body" dangerouslySetInnerHTML={{ __html: html }} />
  </article>
);

/** A labelled field with an optional right-aligned counter and a hint. */
export const Field: React.FC<{
  label: React.ReactNode;
  htmlFor?: string;
  aside?: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, htmlFor, aside, hint, children }) => (
  <div style={{ marginBottom: '1rem' }}>
    <label className="legal-field-label" htmlFor={htmlFor}>
      <span>{label}</span>
      {aside && <span style={{ fontWeight: 500, color: 'var(--color-text-dim)' }}>{aside}</span>}
    </label>
    {children}
    {hint && <p className="legal-field-hint">{hint}</p>}
  </div>
);

export const SectionTitle: React.FC<{ children: React.ReactNode; aside?: React.ReactNode }> = ({ children, aside }) => <div className="legal-section-title"><h3>{children}</h3>{aside}</div>;

export const LegalError: React.FC<{ message: string; retry?: () => void }> = ({ message, retry }) => <div className="legal-error" role="alert"><AlertTriangle size={22} /><p>{message}</p>{retry && <button type="button" className="btn-secondary" onClick={retry}>Try again</button>}</div>;

/** Dialog content scrolls independently; keyboard focus stays with the workflow. */
export const LegalModal: React.FC<{
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  busy?: boolean;
  width?: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
}> = ({ title, subtitle, onClose, busy = false, width = 640, children, footer }) => {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const actions = useRef({ busy, onClose });
  useEffect(() => { actions.current = { busy, onClose }; }, [busy, onClose]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>('[aria-label="Close"]')?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('[role="alertdialog"], [role="listbox"]')) return;
      if (event.key === 'Escape' && !actions.current.busy) { event.preventDefault(); actions.current.onClose(); }
      if (event.key !== 'Tab' || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('*')).filter((node) => node.matches('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') && !node.closest('[hidden]'));
      const first = controls[0]; const last = controls.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  return createPortal(
    <div className="modal-backdrop legal-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={dialogRef} tabIndex={-1} className="modal-content legal-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} style={{ maxWidth: width }}>
        <header className="legal-modal-header"><div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="legal-tool" onClick={onClose} disabled={busy} aria-label="Close"><X size={18} /></button></header>
        <div className="legal-modal-body">{children}</div>
        {footer && <footer className="legal-modal-footer">{footer}</footer>}
      </div>
    </div>, document.body,
  );
};

/** A radio or checkbox presented as a selectable card. */
export const ChoiceCard: React.FC<{
  name: string;
  type?: 'radio' | 'checkbox';
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
}> = ({ name, type = 'radio', checked, disabled = false, onSelect, title, description }) => (
  <label
    className={`legal-choice${checked ? ' is-selected' : ''}`}
    style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
  >
    <input type={type} name={name} checked={checked} disabled={disabled} onChange={onSelect} />
    <span>
      <span className="legal-choice-title">{title}</span>
      {description && (
        <span className="legal-choice-desc" style={{ display: 'block' }}>
          {description}
        </span>
      )}
    </span>
  </label>
);
