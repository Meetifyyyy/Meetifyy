import React, { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Bold, CheckCircle, Eye, Italic, List, Loader2, Lock, Send, X } from 'lucide-react';

import { supportApi } from './supportApi';
import { STATUS_ORDER, statusLabel } from './supportConstants';

/**
 * The reply editor.
 *
 * Collapsed to a single line until the admin actually wants to write. An
 * always-open composer with a toolbar, a note field and a status picker takes
 * most of the pane's height, which pushes the conversation - the thing being
 * replied to - out of view. Reading comes first; the controls appear when they
 * are needed.
 *
 * The editing surface is `contentEditable` with a small fixed toolbar rather
 * than a rich-text library: the only formatting a support reply needs is bold,
 * italic and a list, and every extra capability is another shape of markup the
 * server-side sanitizer has to strip. The server sanitizes regardless (see
 * sanitizeReplyHtml); this just keeps what an admin can produce close to what
 * will survive.
 *
 * The reply and the internal note are submitted together so an admin cannot
 * send the reply and then lose the note to a second request that fails, but
 * they stay visually and textually distinct at every point: confusing them
 * means mailing a user the team's private assessment of them.
 */
export const ReplyComposer: React.FC<{
  ticketId: string;
  currentStatus: string;
  onSent: () => void;
}> = ({ ticketId, currentStatus, onSent }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const [status, setStatus] = useState(currentStatus);
  const [internalNote, setInternalNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [preview, setPreview] = useState<{ html: string; wasModified: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  // A status set on another control while the composer sat open should not be
  // silently reverted by this one when the reply is finally sent.
  useEffect(() => setStatus(currentStatus), [currentStatus]);

  useEffect(() => {
    if (expanded) editorRef.current?.focus();
  }, [expanded]);

  const collapse = () => {
    if (editorRef.current) editorRef.current.innerHTML = '';
    setIsEmpty(true);
    setInternalNote('');
    setShowNote(false);
    setConfirming(false);
    setPreview(null);
    setError(null);
    setExpanded(false);
  };

  const replyMutation = useMutation({
    mutationFn: () =>
      supportApi.reply(ticketId, {
        body: editorRef.current?.innerHTML ?? '',
        status,
        internalNote: internalNote.trim() || undefined,
      }),
    onSuccess: (result: any) => {
      collapse();
      // The reply is saved either way. What the admin needs to know is whether
      // the user has actually received it, so the two outcomes look different.
      setNotice(
        result?.emailQueued
          ? { tone: 'ok', text: 'Reply sent to the user.' }
          : { tone: 'warn', text: 'Reply saved, but the email could not be queued. Use Resend on the reply below.' },
      );
      onSent();
    },
    onError: (e: any) => {
      setConfirming(false);
      setError(e?.message || 'The reply could not be sent.');
    },
  });

  const previewMutation = useMutation({
    mutationFn: () => supportApi.previewReply(editorRef.current?.innerHTML ?? ''),
    onSuccess: (result: any) => setPreview({ html: result.html, wasModified: result.wasModified }),
    onError: (e: any) => setError(e?.message || 'The preview could not be generated.'),
  });

  /**
   * `document.execCommand` is deprecated but remains the only way to apply
   * formatting to a contentEditable selection without shipping an editor
   * framework. Every browser this dashboard supports still implements it, and
   * if that changes the failure mode is that the button does nothing - the
   * admin can still type and send.
   */
  const format = (command: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false);
    syncEmptiness();
  };

  const syncEmptiness = () => setIsEmpty((editorRef.current?.textContent?.trim().length ?? 0) === 0);

  const statusChanged = status !== currentStatus;

  return (
    <div style={wrap}>
      {(error || notice) && (
        <div style={error ? bannerError : notice!.tone === 'ok' ? bannerOk : bannerWarn} role="status">
          {error ? <AlertTriangle size={14} /> : notice!.tone === 'ok' ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
          <span style={{ flex: 1 }}>{error || notice!.text}</span>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setNotice(null);
            }}
            style={iconOnly}
            aria-label="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {!expanded ? (
        <button type="button" style={collapsedBar} onClick={() => setExpanded(true)}>
          <Send size={14} style={{ color: 'var(--color-text-dim)' }} />
          <span>Write a reply to the user</span>
        </button>
      ) : (
        <div style={panel}>
          <div style={toolbar}>
            <button type="button" style={toolButton} onClick={() => format('bold')} title="Bold" aria-label="Bold">
              <Bold size={13} />
            </button>
            <button type="button" style={toolButton} onClick={() => format('italic')} title="Italic" aria-label="Italic">
              <Italic size={13} />
            </button>
            <button
              type="button"
              style={toolButton}
              onClick={() => format('insertUnorderedList')}
              title="Bulleted list"
              aria-label="Bulleted list"
            >
              <List size={13} />
            </button>

            <div style={{ flex: 1 }} />

            <button
              type="button"
              style={linkButton}
              disabled={isEmpty || previewMutation.isPending}
              onClick={() => previewMutation.mutate()}
            >
              {previewMutation.isPending ? <Loader2 size={12} className="spin" /> : <Eye size={12} />}
              <span>Preview</span>
            </button>
            <button type="button" style={iconOnly} onClick={collapse} aria-label="Discard reply">
              <X size={14} />
            </button>
          </div>

          <div
            ref={editorRef}
            contentEditable
            role="textbox"
            aria-multiline="true"
            aria-label="Reply to the user"
            data-placeholder="Write your reply. This will be emailed to the user."
            style={editor}
            onInput={syncEmptiness}
            onBlur={syncEmptiness}
            suppressContentEditableWarning
          />

          {preview && (
            <div style={previewBox}>
              <div style={previewHeader}>
                <span>What the user will see</span>
                <button type="button" onClick={() => setPreview(null)} style={iconOnly} aria-label="Close preview">
                  <X size={12} />
                </button>
              </div>
              {preview.wasModified && (
                <div style={{ ...bannerWarn, marginBottom: '0.5rem' }}>
                  <AlertTriangle size={12} />
                  <span>Some formatting was removed for safety. The version below is what will be sent.</span>
                </div>
              )}
              {/* Server-sanitized output shown back, not raw editor content. */}
              <div style={previewBody} dangerouslySetInnerHTML={{ __html: preview.html }} />
            </div>
          )}

          {showNote ? (
            <div>
              <label style={noteLabel} htmlFor="internal-note">
                <Lock size={11} />
                Internal note, not sent to the user
              </label>
              <textarea
                id="internal-note"
                className="input-control"
                rows={2}
                style={{ width: '100%', fontSize: '0.78rem', marginTop: '0.25rem' }}
                placeholder="Context for the team."
                value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
              />
            </div>
          ) : (
            <button type="button" style={linkButton} onClick={() => setShowNote(true)}>
              <Lock size={11} />
              Add an internal note
            </button>
          )}

          <div style={actions}>
            <label style={statusControl}>
              Then set to
              <select
                className="input-control"
                style={{ padding: '0.25rem 0.4rem', fontSize: '0.75rem' }}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {STATUS_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {statusLabel(value)}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ flex: 1 }} />

            {confirming ? (
              <>
                <span style={{ fontSize: '0.73rem', color: 'var(--color-text-light)' }}>
                  Email this reply{statusChanged ? ` and set to ${statusLabel(status)}` : ''}?
                </span>
                <button type="button" className="btn-secondary" style={smallBtn} onClick={() => setConfirming(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  style={smallBtn}
                  disabled={replyMutation.isPending}
                  onClick={() => replyMutation.mutate()}
                >
                  {replyMutation.isPending ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
                  <span>{replyMutation.isPending ? 'Sending' : 'Confirm and send'}</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn-primary"
                style={smallBtn}
                disabled={isEmpty}
                // Confirmed rather than sent outright: this is an email to a
                // real person and cannot be recalled once it leaves.
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  setConfirming(true);
                }}
              >
                <Send size={13} />
                <span>Send reply</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Styles ─────────────────────────────────────────────────────────────────

const wrap: React.CSSProperties = {
  borderTop: '1px solid var(--color-border)',
  background: 'var(--color-bg-alt)',
  padding: '0.7rem 1rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  flexShrink: 0,
};

const collapsedBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  width: '100%',
  padding: '0.6rem 0.8rem',
  fontFamily: 'inherit',
  fontSize: '0.82rem',
  color: 'var(--color-text-dim)',
  textAlign: 'left',
  background: 'var(--color-bg-white)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'text',
};

const panel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.5rem' };

const toolbar: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.25rem' };

const toolButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '1.6rem',
  height: '1.6rem',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-bg-white)',
  color: 'var(--color-text-main)',
  cursor: 'pointer',
};

const editor: React.CSSProperties = {
  minHeight: '4.5rem',
  maxHeight: '11rem',
  overflowY: 'auto',
  padding: '0.6rem 0.75rem',
  fontSize: '0.83rem',
  lineHeight: 1.6,
  color: 'var(--color-text-main)',
  background: 'var(--color-bg-white)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  outline: 'none',
};

const previewBox: React.CSSProperties = {
  padding: '0.7rem 0.8rem',
  background: 'var(--color-bg-white)',
  border: '1px dashed var(--color-border)',
  borderRadius: 'var(--radius-sm)',
};

const previewHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: '0.65rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--color-text-light)',
  marginBottom: '0.4rem',
};

const previewBody: React.CSSProperties = { fontSize: '0.83rem', lineHeight: 1.6, color: 'var(--color-text-main)' };

const noteLabel: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.3rem',
  fontSize: '0.68rem',
  fontWeight: 600,
  color: 'var(--color-warning, #b45309)',
};

const linkButton: React.CSSProperties = {
  alignSelf: 'flex-start',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.3rem',
  padding: 0,
  border: 'none',
  background: 'none',
  fontFamily: 'inherit',
  fontSize: '0.72rem',
  color: 'var(--color-text-light)',
  cursor: 'pointer',
};

const actions: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem' };

const statusControl: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.3rem',
  fontSize: '0.72rem',
  color: 'var(--color-text-light)',
};

const bannerBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.45rem 0.6rem',
  fontSize: '0.75rem',
  borderRadius: 'var(--radius-sm)',
};

const bannerError: React.CSSProperties = {
  ...bannerBase,
  background: 'var(--color-danger-tint, rgba(220,38,38,0.06))',
  color: 'var(--color-danger)',
};

const bannerOk: React.CSSProperties = {
  ...bannerBase,
  background: 'var(--color-success-tint, rgba(22,163,74,0.07))',
  color: 'var(--color-success)',
};

const bannerWarn: React.CSSProperties = {
  ...bannerBase,
  background: 'var(--color-warning-tint, rgba(245,158,11,0.08))',
  color: 'var(--color-warning, #b45309)',
};

const iconOnly: React.CSSProperties = {
  display: 'inline-flex',
  border: 'none',
  background: 'none',
  color: 'inherit',
  cursor: 'pointer',
  padding: 0,
};

const smallBtn: React.CSSProperties = { padding: '0.35rem 0.7rem', fontSize: '0.76rem' };
