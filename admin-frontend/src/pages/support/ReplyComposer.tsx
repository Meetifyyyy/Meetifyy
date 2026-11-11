import { Dropdown } from '../../components/Dropdown';
import React, { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Bold, CheckCircle, Eye, Italic, List, Loader2, Lock, Send, X } from '../../components/icons';

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
  const statusControlId = React.useId();
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
          ? { tone: 'ok', text: 'Reply saved and email queued.' }
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
    <div className="support-reply">
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
            className="support-icon-button"
            aria-label="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {!expanded ? (
        <button type="button" className="support-reply-open" onClick={() => setExpanded(true)}>
          <Send size={14} style={{ color: 'var(--color-text-dim)' }} />
          <span>Write a reply to the user</span>
        </button>
      ) : (
        <fieldset className="support-reply-panel" disabled={replyMutation.isPending} aria-busy={replyMutation.isPending}>
          <div className="support-reply-toolbar">
            <button type="button" className="support-format-button" onClick={() => format('bold')} title="Bold" aria-label="Bold">
              <Bold size={13} />
            </button>
            <button type="button" className="support-format-button" onClick={() => format('italic')} title="Italic" aria-label="Italic">
              <Italic size={13} />
            </button>
            <button
              type="button"
              className="support-format-button"
              onClick={() => format('insertUnorderedList')}
              title="Bulleted list"
              aria-label="Bulleted list"
            >
              <List size={13} />
            </button>

            <div style={{ flex: 1 }} />

            <button
              type="button"
              className="support-reply-link"
              disabled={isEmpty || previewMutation.isPending}
              onClick={() => previewMutation.mutate()}
            >
              {previewMutation.isPending ? <Loader2 size={12} className="spin" /> : <Eye size={12} />}
              <span>Preview</span>
            </button>
            <button type="button" className="support-icon-button" onClick={collapse} aria-label="Discard reply">
              <X size={14} />
            </button>
          </div>

          <div
            ref={editorRef}

            contentEditable={!replyMutation.isPending}
            role="textbox"
            aria-multiline="true"
            aria-label="Reply to the user"
            data-placeholder="Write your reply. This will be emailed to the user."
            className="admin-rich-text-input support-reply-editor"
            onInput={syncEmptiness}
            onBlur={syncEmptiness}
            suppressContentEditableWarning
          />

          {preview && (
            <div className="support-preview">
              <div className="support-preview-header">
                <span>What the user will see</span>
                <button type="button" onClick={() => setPreview(null)} className="support-icon-button" aria-label="Close preview">
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
              <div className="support-message-body" dangerouslySetInnerHTML={{ __html: preview.html }} />
            </div>
          )}

          {showNote ? (
            <div>
              <label className="support-note-label" htmlFor="internal-note">
                <Lock size={11} />
                Internal note, not sent to the user
              </label>
              <textarea
                id="internal-note"
                className="input-control"
                rows={2}
                style={{ width: '100%', marginTop: '0.25rem' }}
                placeholder="Context for the team."
                value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
              />
            </div>
          ) : (
            <button type="button" className="support-reply-link" onClick={() => setShowNote(true)}>
              <Lock size={11} />
              Add an internal note
            </button>
          )}

          <div className="support-reply-actions">
            <div className="support-reply-status">
              <label htmlFor={statusControlId}>Then set to</label>
              <Dropdown
                id={statusControlId}
                className="input-control"
                aria-label="Ticket status after reply"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {STATUS_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {statusLabel(value)}
                  </option>
                ))}
              </Dropdown>
            </div>

            <div style={{ flex: 1, minWidth: '0.5rem' }} />

            {confirming ? (
              <div className="support-reply-confirm" role="group" aria-label="Confirm email reply">
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-light)' }}>
                  Email this reply{statusChanged ? ` and set to ${statusLabel(status)}` : ''}?
                </span>
                <button type="button" className="btn-secondary support-small-button" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary support-small-button"
                  disabled={replyMutation.isPending}
                  onClick={() => replyMutation.mutate()}
                >
                  {replyMutation.isPending ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
                  <span>{replyMutation.isPending ? 'Sending' : 'Confirm and send'}</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn-primary support-small-button"
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
        </fieldset>
      )}
    </div>
  );
};

// ── Styles ─────────────────────────────────────────────────────────────────

const bannerBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.45rem 0.6rem',
  fontSize: '0.8125rem',
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
