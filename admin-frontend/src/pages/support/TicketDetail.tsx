import { LoadingState } from '../../components/LoadingState';
import { Dropdown } from '../../components/Dropdown';
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  Loader2,
  Lock,
  Mail,
  MailWarning,
  Paperclip,
  RefreshCw,
  User as UserIcon,
  X,
} from '../../components/icons';

import { supportApi } from './supportApi';
import {
  PRIORITY_BADGE,
  PRIORITY_ORDER,
  STATUS_BADGE,
  STATUS_ORDER,
  categoryLabel,
  formatDateTime,
  priorityLabel,
  statusLabel,
} from './supportConstants';
import { ReplyComposer } from './ReplyComposer';
import { useConfirm } from '../../components/ConfirmProvider';

/**
 * One ticket: the conversation, with triage controls around it.
 *
 * The conversation gets the vertical space and everything else earns its
 * place. Status, priority and assignment sit in one compact row rather than as
 * three labelled selects, and the diagnostic metadata is behind a disclosure -
 * it matters when an admin goes looking for it, not on every ticket open.
 *
 * Internal notes are rendered here and nowhere else, and are visually distinct
 * from replies for a reason that is not decoration: an admin has to tell at a
 * glance which entries the user has seen, because the difference between a
 * note and a reply is the difference between a private remark and an email
 * that has already left.
 */
export const TicketDetail: React.FC<{
  ticketId: string;
  onChanged?: () => void;
  onBack?: () => void;
}> = ({ ticketId, onChanged, onBack }) => {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [banner, setBanner] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const { data: ticket, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['adminSupportTicket', ticketId],
    queryFn: () => supportApi.getTicket(ticketId),
  });

  const { data: assignees } = useQuery({
    queryKey: ['adminSupportAssignees'],
    queryFn: () => supportApi.getAssignees(),
    // The admin roster changes far less often than the queue does.
    staleTime: 5 * 60 * 1000,
  });

  // Clear a stale banner when moving to another ticket, so a message about the
  // previous one does not appear to belong to this one.
  useEffect(() => {
    setBanner(null);
    setShowDetails(false);
  }, [ticketId]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['adminSupportTicket', ticketId] });
    queryClient.invalidateQueries({ queryKey: ['adminSupportTickets'] });
    queryClient.invalidateQueries({ queryKey: ['adminSupportStats'] });
    onChanged?.();
  };

  const fail = (fallback: string) => (e: any) => setBanner({ tone: 'error', text: e?.message || fallback });

  const statusMutation = useMutation({
    mutationFn: (status: string) => supportApi.setStatus(ticketId, status),
    onSuccess: invalidate,
    onError: fail('The status could not be changed.'),
  });

  const priorityMutation = useMutation({
    mutationFn: (priority: string) => supportApi.setPriority(ticketId, priority),
    onSuccess: invalidate,
    onError: fail('The priority could not be changed.'),
  });

  const assignMutation = useMutation({
    mutationFn: (adminId: string | null) => supportApi.assign(ticketId, adminId),
    onSuccess: invalidate,
    onError: fail('The ticket could not be assigned.'),
  });

  const resendMutation = useMutation({
    mutationFn: (messageId: string) => supportApi.resendReply(ticketId, messageId),
    onSuccess: (result: any) => {
      invalidate();
      setBanner(
        result?.emailQueued
          ? { tone: 'ok', text: 'The reply has been queued for delivery again.' }
          : { tone: 'error', text: 'The reply still could not be queued. Check the mail configuration.' },
      );
    },
    onError: fail('The reply could not be resent.'),
  });

  const resendConfirmation = useMutation({
    mutationFn: () => supportApi.resendConfirmation(ticketId),
    onSuccess: () => {
      invalidate();
      setBanner({ tone: 'ok', text: 'The confirmation email has been queued again.' });
    },
    onError: fail('The confirmation could not be resent.'),
  });

  const attachments: any[] = useMemo(
    () => (Array.isArray(ticket?.attachments) ? ticket.attachments : []),
    [ticket],
  );

  if (isLoading) {
    return (
      <div className="support-detail-state">{onBack && <button type="button" className="btn-secondary support-back" onClick={onBack}><ChevronLeft size={16} />Back to tickets</button>}<LoadingState label="Loading ticket" /></div>
    );
  }

  if (isError) {
    return (
      <div className="support-empty">
        {onBack && <button type="button" className="btn-secondary support-back" onClick={onBack}><ChevronLeft size={16} />Back to tickets</button>}
        <AlertTriangle size={20} color="var(--color-danger)" />
        <span>{(error as any)?.message || 'This ticket could not be loaded.'}</span>
        <button className="btn-secondary" onClick={() => refetch()}>
          <RefreshCw size={14} />
          <span>Try again</span>
        </button>
      </div>
    );
  }

  const busy = statusMutation.isPending || priorityMutation.isPending || assignMutation.isPending;

  return (
    <div className="support-ticket-detail">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="support-detail-header">
        <div className="support-ticket-badges">
          <span style={ticketRef}>{ticket.ticketNumber}</span>
          <span className={`badge ${STATUS_BADGE[ticket.status] ?? 'badge-neutral'}`}>{statusLabel(ticket.status)}</span>
          {(ticket.priority === 'HIGH' || ticket.priority === 'URGENT') && (
            <span className={`badge ${PRIORITY_BADGE[ticket.priority]}`}>{priorityLabel(ticket.priority)}</span>
          )}
        </div>

        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="btn-secondary support-back"
          >
            <ChevronLeft size={13} />
            <span>Back to tickets</span>
          </button>
        )}
        <h3 className="support-detail-subject">{ticket.subject}</h3>

        <div className="support-requester">
          {ticket.type === 'IDEA' ? 'Idea · ' : ''}
          {categoryLabel(ticket.category)} ·{' '}
          <a href={`mailto:${ticket.email}`} style={{ color: 'inherit' }}>
            {ticket.name ? `${ticket.name} <${ticket.email}>` : ticket.email}
          </a>
          {ticket.user ? ` · @${ticket.user.username}` : ' · guest'}
        </div>
      </div>

      {/* ── Triage row ───────────────────────────────────────────────────── */}
      <div className="support-triage">
        <CompactSelect
          value={ticket.status}
          disabled={busy}
          onChange={(v) => statusMutation.mutate(v)}
          options={STATUS_ORDER.map((v) => ({ value: v, label: statusLabel(v) }))}
          aria-label="Ticket status"
        />
        <CompactSelect
          value={ticket.priority}
          disabled={busy}
          onChange={(v) => priorityMutation.mutate(v)}
          options={PRIORITY_ORDER.map((v) => ({ value: v, label: `${priorityLabel(v)} priority` }))}
          aria-label="Ticket priority"
        />
        <CompactSelect
          value={ticket.assignedAdminId ?? ''}
          disabled={busy}
          onChange={(v) => assignMutation.mutate(v || null)}
          options={[
            { value: '', label: 'Unassigned' },
            ...(assignees ?? []).map((a: any) => ({ value: a.id, label: a.name })),
          ]}
          aria-label="Assigned administrator"
        />

        <div style={{ flex: 1 }} />

        {busy && <Loader2 size={13} className="spin" style={{ color: 'var(--color-text-dim)' }} />}

        <button type="button" className="support-details-toggle" onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails}>
          <span>Details</span>
          <ChevronDown
            size={12}
            style={{ transform: showDetails ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s ease' }}
          />
        </button>
      </div>

      {banner && (
        <div style={banner.tone === 'error' ? bannerError : bannerOk} role="status">
          {banner.tone === 'error' ? <AlertTriangle size={14} /> : <CheckCircle size={14} />}
          <span style={{ flex: 1 }}>{banner.text}</span>
          <button type="button" onClick={() => setBanner(null)} className="support-icon-button" aria-label="Dismiss">
            <X size={13} />
          </button>
        </div>
      )}

      {/*
        A failed confirmation means the user believes support has their request
        and has no Request ID to quote. Always shown, never behind a disclosure.
      */}
      {ticket.emailStatus === 'FAILED' && (
        <div style={bannerError}>
          <MailWarning size={14} />
          <span style={{ flex: 1 }}>
            The confirmation email was not delivered{ticket.emailError ? `: ${ticket.emailError}` : ''}.
          </span>
          <button
            className="btn-secondary support-small-button"
            disabled={resendConfirmation.isPending}
            onClick={() => confirm({
              title: 'Resend the confirmation email?',
              description: 'Another copy is sent to the person who opened this ticket.',
              consequences: ['They receive a second email; it cannot be unsent.'],
              severity: 'moderate',
              confirmLabel: 'Resend',
              onConfirm: () => resendConfirmation.mutateAsync(),
            })}
          >
            {resendConfirmation.isPending ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
            <span>Resend</span>
          </button>
        </div>
      )}

      {showDetails && (
        <div className="support-ticket-details">
          <Meta label="Submitted" value={formatDateTime(ticket.createdAt)} />
          <Meta label="Last update" value={formatDateTime(ticket.updatedAt)} />
          {ticket.resolvedAt && <Meta label="Resolved" value={formatDateTime(ticket.resolvedAt)} />}
          {ticket.pageContext && <Meta label="Page" value={ticket.pageContext} />}
          {ticket.browserInfo && (
            <Meta
              label="Client"
              value={
                [ticket.browserInfo.browser, ticket.browserInfo.os, ticket.browserInfo.deviceType]
                  .filter(Boolean)
                  .join(' · ') || String(ticket.browserInfo.userAgent ?? '-')
              }
            />
          )}
          {attachments.length > 0 && (
            <div style={{ gridColumn: '1 / -1' }}>
              <div className="support-field-label">Attachments</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.25rem' }}>
                {attachments.map((file: any) => (
                  <a
                    key={file.key}
                    // Signed, expiring link from the API. There is no public
                    // /api/media fallback: support files are private.
                    href={file.url ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="support-attachment"
                    aria-disabled={!file.url}
                  >
                    <Paperclip size={11} />
                    <span>{file.filename || file.mimeType?.split('/')[1]?.toUpperCase() || 'FILE'}{!file.url ? ' · Link unavailable' : ''}</span>
                    <span style={{ color: 'var(--color-text-light)' }}>{Math.round((file.size ?? 0) / 1024)} KB</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Conversation ─────────────────────────────────────────────────── */}
      <div className="support-conversation">
        {ticket.messages?.map((message: any) => {
          const isAdmin = message.authorType === 'ADMIN';
          const isNote = message.isInternal;

          return (
            <div
              key={message.id}
              className={`support-message ${isNote ? 'is-note' : isAdmin ? 'is-admin' : 'is-user'}`}
            >
              <div className="support-message-meta">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.28rem', fontWeight: 600 }}>
                  {isNote ? <Lock size={10} /> : isAdmin ? <Mail size={10} /> : <UserIcon size={10} />}
                  {isNote
                    ? `Internal note · ${message.author?.name ?? 'Admin'}`
                    : isAdmin
                      ? message.author?.name ?? 'Support'
                      : ticket.user
                        ? `@${ticket.user.username}`
                        : ticket.name || ticket.email}
                </span>
                <span>{formatDateTime(message.createdAt)}</span>
              </div>

              {isAdmin && !isNote ? (
                /*
                  Admin replies are stored as rich text that the server
                  sanitized before saving (sanitizeReplyHtml), so the stored
                  value is already the safe one. Rendering it as markup is what
                  makes the thread show what the user actually received.
                */
                <div className="support-message-body" dangerouslySetInnerHTML={{ __html: message.body }} />
              ) : (
                // User text and internal notes are plain text and stay plain
                // text, rendered as a text node and never as markup.
                <div className="support-message-body is-plain">{message.body}</div>
              )}

              {isAdmin && !isNote && (
                <DeliveryStatus
                  message={message}
                  onResend={() => confirm({
                    title: 'Resend this reply?',
                    description: 'The reply is emailed to the ticket owner again.',
                    consequences: ['They receive a duplicate; it cannot be unsent.'],
                    severity: 'moderate',
                    confirmLabel: 'Resend reply',
                    onConfirm: () => resendMutation.mutateAsync(message.id),
                  })}
                  pending={resendMutation.isPending}
                />
              )}
            </div>
          );
        })}
      </div>

      <ReplyComposer ticketId={ticketId} currentStatus={ticket.status} onSent={invalidate} />
    </div>
  );
};

/** Ticket metadata uses the shared dropdown with its existing value handlers. */
const CompactSelect: React.FC<{
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  'aria-label': string;
}> = ({ value, disabled, onChange, options, ...rest }) => (
  <Dropdown
    value={value}
    disabled={disabled}
    onChange={(e) => onChange(e.target.value)}
    aria-label={rest['aria-label']}
    className="support-triage-select"
  >
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </Dropdown>
);

/**
 * Delivery outcome for one reply.
 *
 * A reply recorded but never delivered is the failure worth shouting about:
 * the admin believes they answered and the user is still waiting. It gets a
 * warning and a retry, not a quiet grey label.
 */
const DeliveryStatus: React.FC<{ message: any; onResend: () => void; pending: boolean }> = ({
  message,
  onResend,
  pending,
}) => {
  if (message.emailStatus === 'SENT') {
    return (
      <div style={{ ...deliveryRow, color: 'var(--color-success)' }}>
        <CheckCircle size={10} />
        <span>Delivered {message.emailSentAt ? formatDateTime(message.emailSentAt) : ''}</span>
      </div>
    );
  }

  if (message.emailStatus === 'FAILED') {
    return (
      <div style={{ ...deliveryRow, color: 'var(--color-danger)', alignItems: 'center' }}>
        <MailWarning size={10} />
        <span style={{ flex: 1 }}>Not delivered{message.emailError ? `: ${message.emailError}` : ''}</span>
        <button className="btn-secondary support-small-button" onClick={onResend} disabled={pending}>
          {pending ? <Loader2 size={10} className="spin" /> : <RefreshCw size={10} />}
          <span>Resend</span>
        </button>
      </div>
    );
  }

  return (
    <div style={{ ...deliveryRow, color: 'var(--color-text-light)' }}>
      <Loader2 size={10} className="spin" />
      <span>Sending</span>
    </div>
  );
};

const Meta: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div>
    <div className="support-field-label">{label}</div>
    <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-main)', wordBreak: 'break-word' }}>{value}</div>
  </div>
);

// ── Styles ─────────────────────────────────────────────────────────────────
// Delivery and feedback tones are shared by the message states.

const ticketRef: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.75rem',
  fontWeight: 600,
  letterSpacing: '0.02em',
  color: 'var(--color-text-light)',
};

const deliveryRow: React.CSSProperties = {
  display: 'flex',
  gap: '0.3rem',
  marginTop: '0.45rem',
  paddingTop: '0.35rem',
  borderTop: '1px solid rgba(0,0,0,0.06)',
  fontSize: '0.75rem',
};

const bannerBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.45rem',
  padding: '0.5rem 1rem',
  fontSize: '0.8125rem',
  borderBottom: '1px solid var(--color-border)',
  flexShrink: 0,
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
