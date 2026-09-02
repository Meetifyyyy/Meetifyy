import React, { useEffect, useState } from 'react';
import { AlertTriangle, X } from './icons';

/**
 * The admin panel's failure surface.
 *
 * Every mutation on this panel performs a privileged action — suspending an
 * account, deleting a college, revoking a session. Before this existed most of
 * them had no `onError`, so a rejected request left the UI exactly as it was:
 * the row never changed, nothing was announced, and the admin had no way to
 * tell a refused action from a completed one. `QueryClient`'s `MutationCache`
 * routes those failures here (see App.tsx), which covers existing handlers and
 * any added later without each one re-implementing a banner.
 *
 * Deliberately a plain module-level store rather than context: the emitter is
 * the QueryClient, which is constructed outside the React tree.
 */

export interface Toast {
  id: number;
  message: string;
  tone: 'error' | 'success';
}

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
let listeners: Listener[] = [];
let nextId = 1;

const emit = () => listeners.forEach((l) => l(toasts));

const dismiss = (id: number) => {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
};

export function pushToast(message: string, tone: Toast['tone'] = 'error') {
  const id = nextId++;
  toasts = [...toasts, { id, message, tone }];
  emit();
  // Errors linger long enough to be read and copied; confirmations do not.
  window.setTimeout(() => dismiss(id), tone === 'error' ? 9000 : 4000);
  return id;
}

export const Toaster: React.FC = () => {
  const [items, setItems] = useState<Toast[]>(toasts);

  useEffect(() => {
    listeners.push(setItems);
    return () => {
      listeners = listeners.filter((l) => l !== setItems);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      // Announced to screen readers: a failed privileged action must not be a
      // purely visual event.
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: '1rem',
        right: '1rem',
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.6rem',
        maxWidth: 'min(420px, calc(100vw - 2rem))',
        pointerEvents: 'none',
      }}
    >
      {items.map((t) => {
        const isError = t.tone === 'error';
        return (
          <div
            key={t.id}
            style={{
              pointerEvents: 'auto',
              background: 'var(--color-bg-white)',
              border: `1px solid ${isError ? 'rgba(239, 68, 68, 0.35)' : 'rgba(16, 185, 129, 0.35)'}`,
              borderLeft: `3px solid ${isError ? 'var(--color-danger)' : 'var(--color-success)'}`,
              borderRadius: 'var(--radius-sm)',
              boxShadow: 'var(--shadow-lg)',
              padding: '0.75rem 0.85rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.6rem',
              fontSize: '0.84rem',
              color: 'var(--color-text-main)',
            }}
          >
            {isError && (
              <AlertTriangle size={16} color="var(--color-danger)" style={{ flexShrink: 0, marginTop: '1px' }} />
            )}
            <span style={{ flex: 1, wordBreak: 'break-word' }}>{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-dim)', padding: 0, flexShrink: 0 }}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
