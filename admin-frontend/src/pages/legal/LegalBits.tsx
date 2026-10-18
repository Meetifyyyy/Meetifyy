import React, { useEffect } from 'react';
import { X } from '../../components/icons';
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

export const SectionTitle: React.FC<{ children: React.ReactNode; aside?: React.ReactNode }> = ({
  children,
  aside,
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '0.75rem',
      margin: '1.5rem 0 0.75rem',
    }}
  >
    <h3
      style={{
        fontSize: '0.78rem',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: 'var(--color-text-light)',
      }}
    >
      {children}
    </h3>
    {aside}
  </div>
);

/** A portal modal: Escape and the backdrop close it unless `busy`. */
export const LegalModal: React.FC<{
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  busy?: boolean;
  width?: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
}> = ({ title, subtitle, onClose, busy = false, width = 560, children, footer }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-modal-title"
        style={{ maxWidth: width, display: 'flex', flexDirection: 'column' }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '1rem',
            padding: '1.1rem 1.25rem 0.9rem',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2 id="legal-modal-title" style={{ fontSize: '1.02rem', fontWeight: 700 }}>
              {title}
            </h2>
            {subtitle && (
              <p style={{ marginTop: '0.2rem', fontSize: '0.8rem', color: 'var(--color-text-light)' }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            className="legal-tool"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>
        <div style={{ padding: '1.1rem 1.25rem', overflowY: 'auto' }}>{children}</div>
        {footer && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '0.5rem',
              flexWrap: 'wrap',
              padding: '0.85rem 1.25rem',
              borderTop: '1px solid var(--color-border)',
              background: 'var(--color-bg-alt)',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
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
