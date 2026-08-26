import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  Loader2,
  Lock,
  Mail,
  MailWarning,
  Paperclip,
  RefreshCw,
  User as UserIcon,
  X,
} from 'lucide-react';

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
export const TicketDetail: React.FC<{ ticketId: string; onChanged?: () => void }> = ({ ticketId, onChanged }) => {
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
      <div style={centered}>
        <Loader2 size={18} className="spin" />
        <span>Loading ticket</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div style={centered}>
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div style={header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.15rem' }}>
          <span style={ticketRef}>{ticket.ticketNumber}</span>
          <span className={`badge ${STATUS_BADGE[ticket.status] ?? 'badge-neutral'}`}>{statusLabel(ticket.status)}</span>
          {(ticket.priority === 'HIGH' || ticket.priority === 'URGENT') && (
            <span className={`badge ${PRIORITY_BADGE[ticket.priority]}`}>{priorityLabel(ticket.priority)}</span>
          )}
        </div>

        <h3 style={subjectStyle}>{ticket.subject}</h3>

        <div style={requesterLine}>
          {categoryLabel(ticket.category)} ·{' '}
          <a href={`mailto:${ticket.email}`} style={{ color: 'inherit' }}>
            {ticket.name ? `${ticket.name} <${ticket.email}>` : ticket.email}
          </a>
          {ticket.user ? ` · @${ticket.user.username}` : ' · guest'}
        </div>
      </div>

      {/* ── Triage row ───────────────────────────────────────────────────── */}
      <div style={triageRow}>
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

        <button type="button" style={detailsToggle} onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails}>
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
          <button type="button" onClick={() => setBanner(null)} style={iconOnly} aria-label="Dismiss">
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
            className="btn-secondary"
            style={tinyBtn}
            disabled={resendConfirmation.isPending}
            onClick={() => resendConfirmation.mutate()}
          >
            {resendConfirmation.isPending ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
            <span>Resend</span>
          </button>
        </div>
      )}

      {showDetails && (
        <div style={detailsPanel}>
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
              <div style={metaLabel}>Attachments</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.25rem' }}>
                {attachments.map((file: any) => (
                  <a
                    key={file.key}
                    href={`/api/media/${file.key}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={attachmentChip}
                  >
                    <Paperclip size={11} />
                    <span>{file.filename || file.mimeType?.split('/')[1]?.toUpperCase() || 'FILE'}</span>
                    <span style={{ color: 'var(--color-text-light)' }}>{Math.round((file.size ?? 0) / 1024)} KB</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Conversation ─────────────────────────────────────────────────── */}
      <div style={thread}>
        {ticket.messages?.map((message: any) => {
          const isAdmin = message.authorType === 'ADMIN';
          const isNote = message.isInternal;

          return (
            <div
              key={message.id}
              style={{
                alignSelf: isAdmin ? 'flex-end' : 'flex-start',
                maxWidth: '82%',
                background: isNote
                  ? 'var(--color-warning-tint, rgba(245,158,11,0.08))'
                  : isAdmin
                    ? 'var(--color-primary-tint)'
                    : 'var(--color-bg-soft)',
                border: isNote
                  ? '1px solid rgba(245, 158, 11, 0.35)'
                  : isAdmin
                    ? '1px solid rgba(37, 99, 235, 0.2)'
                    : '1px solid var(--color-border)',
                padding: '0.65rem 0.85rem',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <div style={messageMeta}>
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
                <div style={messageBody} dangerouslySetInnerHTML={{ __html: message.body }} />
              ) : (
                // User text and internal notes are plain text and stay plain
                // text, rendered as a text node and never as markup.
                <div style={{ ...messageBody, whiteSpace: 'pre-wrap' }}>{message.body}</div>
              )}

              {isAdmin && !isNote && (
                <DeliveryStatus
                  message={message}
                  onResend={() => resendMutation.mutate(message.id)}
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

/** A select styled as a quiet inline control rather than a labelled form field. */
const CompactSelect: React.FC<{
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  'aria-label': string;
}> = ({ value, disabled, onChange, options, ...rest }) => (
  <select
    value={value}
    disabled={disabled}
    onChange={(e) => onChange(e.target.value)}
    aria-label={rest['aria-label']}
    style={compactSelect}
  >
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
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
        <button className="btn-secondary" style={tinyBtn} onClick={onResend} disabled={pending}>
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
    <div style={metaLabel}>{label}</div>
    <div style={{ fontSize: '0.76rem', color: 'var(--color-text-main)', wordBreak: 'break-word' }}>{value}</div>
  </div>
);

// ── Styles ─────────────────────────────────────────────────────────────────
// Inline objects, matching how the other admin pages style themselves.

const centered: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.6rem',
  flex: 1,
  height: '100%',
  color: 'var(--color-text-dim)',
  fontSize: '0.85rem',
};

const header: React.CSSProperties = {
  padding: '0.8rem 1rem 0.7rem',
  borderBottom: '1px solid var(--color-border)',
  flexShrink: 0,
};

const ticketRef: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.74rem',
  fontWeight: 700,
  letterSpacing: '0.05em',
  color: 'var(--color-text-light)',
};

const subjectStyle: React.CSSProperties = {
  fontSize: '1rem',
  fontWeight: 700,
  margin: 0,
  wordBreak: 'break-word',
  color: 'var(--color-text-main)',
};

const requesterLine: React.CSSProperties = {
  fontSize: '0.74rem',
  color: 'var(--color-text-light)',
  marginTop: '0.2rem',
};

const triageRow: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '0.35rem',
  padding: '0.5rem 1rem',
  borderBottom: '1px solid var(--color-border)',
  background: 'var(--color-bg-alt)',
  flexShrink: 0,
};

const compactSelect: React.CSSProperties = {
  padding: '0.25rem 0.45rem',
  fontFamily: 'inherit',
  fontSize: '0.74rem',
  color: 'var(--color-text-main)',
  background: 'var(--color-bg-white)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  maxWidth: '11rem',
};

const detailsToggle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.25rem',
  padding: '0.25rem 0.5rem',
  fontFamily: 'inherit',
  fontSize: '0.72rem',
  color: 'var(--color-text-light)',
  background: 'none',
  border: '1px solid transparent',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
};

const detailsPanel: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(8.5rem, 1fr))',
  gap: '0.6rem 1rem',
  padding: '0.75rem 1rem',
  borderBottom: '1px solid var(--color-border)',
  background: 'var(--color-bg-soft)',
  flexShrink: 0,
};

const metaLabel: React.CSSProperties = {
  fontSize: '0.62rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--color-text-light)',
};

const attachmentChip: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.28rem',
  padding: '0.25rem 0.5rem',
  fontSize: '0.68rem',
  fontWeight: 600,
  textDecoration: 'none',
  color: 'var(--color-text-main)',
  background: 'var(--color-bg-white)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
};

const thread: React.CSSProperties = {
  // The conversation is the only element allowed to grow, so it takes whatever
  // height the fixed chrome above and below does not.
  flex: 1,
  minHeight: 0,
  padding: '1rem',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.7rem',
};

const messageMeta: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '1rem',
  fontSize: '0.66rem',
  color: 'var(--color-text-light)',
  marginBottom: '0.3rem',
};

const messageBody: React.CSSProperties = {
  fontSize: '0.83rem',
  lineHeight: 1.6,
  color: 'var(--color-text-main)',
  wordBreak: 'break-word',
};

const deliveryRow: React.CSSProperties = {
  display: 'flex',
  gap: '0.3rem',
  marginTop: '0.45rem',
  paddingTop: '0.35rem',
  borderTop: '1px solid rgba(0,0,0,0.06)',
  fontSize: '0.66rem',
};

const bannerBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.45rem',
  padding: '0.5rem 1rem',
  fontSize: '0.76rem',
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

const iconOnly: React.CSSProperties = {
  display: 'inline-flex',
  border: 'none',
  background: 'none',
  color: 'inherit',
  cursor: 'pointer',
  padding: 0,
};

const tinyBtn: React.CSSProperties = { padding: '0.18rem 0.45rem', fontSize: '0.66rem' };
