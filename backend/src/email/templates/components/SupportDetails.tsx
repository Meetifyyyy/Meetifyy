import * as React from 'react';
import { Hr, Link, Section, Text } from '@react-email/components';

export interface DetailRow {
  label: string;
  value: React.ReactNode;
}

export interface SupportAttachmentItem {
  filename: string;
  url?: string;
  size?: number;
}

/** Format file size in human-readable units (e.g. "245 KB") */
export function formatFileSize(bytes?: number): string | null {
  if (!bytes || typeof bytes !== 'number' || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Compact, elegant Support ID display pill. */
export const SupportIdPill: React.FC<{ ticketNumber: string }> = ({ ticketNumber }) => (
  <Section style={idCardStyle}>
    <table role="presentation" border={0} cellPadding={0} cellSpacing={0} style={{ margin: '0 auto' }}>
      <tbody>
        <tr>
          <td style={idLabelCell}>Your Support ID:</td>
          <td style={idValueCell}>#{ticketNumber}</td>
        </tr>
      </tbody>
    </table>
  </Section>
);

/** Structured Support Request Summary card. */
export const SupportSummaryCard: React.FC<{
  name?: string | null;
  categoryLabel: string;
  subject: string;
  description: string;
}> = ({ name, categoryLabel, subject, description }) => {
  const rows: DetailRow[] = [
    ...(name?.trim() ? [{ label: 'Name', value: name.trim() }] : []),
    { label: 'Issue Category', value: categoryLabel },
    { label: 'Subject', value: subject },
  ];

  return (
    <Section style={summaryBox}>
      <div style={summaryHeader}>
        <Text style={summaryTitle}>Support Request Summary</Text>
      </div>

      <table role="presentation" border={0} cellPadding={0} cellSpacing={0} style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} style={rowBorder}>
              <td style={summaryLabel}>{row.label}</td>
              <td style={summaryValue}>{row.value}</td>
            </tr>
          ))}
          <tr>
            <td style={summaryLabelLast}>Description</td>
            <td style={summaryValueLast}>
              <div style={descriptionContent}>{description}</div>
            </td>
          </tr>
        </tbody>
      </table>
    </Section>
  );
};

/** Dedicated Attachments list with clean filenames and secure view links. */
export const SupportAttachmentsSection: React.FC<{
  attachments: SupportAttachmentItem[];
}> = ({ attachments }) => {
  if (!attachments || attachments.length === 0) return null;

  return (
    <Section style={attachmentsBox}>
      <div style={attachmentsHeader}>
        <Text style={attachmentsTitle}>
          {attachments.length === 1 ? 'Attachment' : `Attachments (${attachments.length})`}
        </Text>
      </div>
      <div style={attachmentsBody}>
        <table role="presentation" border={0} cellPadding={0} cellSpacing={0} style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {attachments.map((item, index) => {
              const formattedSize = formatFileSize(item.size);
              const isLast = index === attachments.length - 1;

              return (
                <tr key={`${item.filename}-${index}`} style={isLast ? undefined : attachmentRowBorder}>
                  <td style={attachmentIconCell}>
                    <span style={attachmentIconBadge}>📎</span>
                  </td>
                  <td style={attachmentInfoCell}>
                    <div style={attachmentNameText}>{item.filename}</div>
                    {formattedSize && <div style={attachmentSizeText}>{formattedSize}</div>}
                  </td>
                  <td style={attachmentActionCell}>
                    {item.url ? (
                      <Link href={item.url} style={attachmentViewButton}>
                        View File
                      </Link>
                    ) : (
                      <span style={attachmentAttachedLabel}>Attached</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
};

/** Standard subtle footer notice for support emails with Help & Support link. */
export const SupportFooterNotice: React.FC<{
  helpCentreUrl: string;
  isAutomatedConfirmation?: boolean;
}> = ({ helpCentreUrl, isAutomatedConfirmation = false }) => (
  <Section style={footerSection}>
    <Hr style={subtleDivider} />
    <Text style={footerNoticeText}>
      {isAutomatedConfirmation ? (
        <>
          This is an automated confirmation email. Please do not reply directly to this email.
          <br />
          For further assistance, please contact us through our{' '}
          <Link href={helpCentreUrl} style={footerNoticeLink}>
            Help and Support page
          </Link>
          .
        </>
      ) : (
        <>
          Please do not reply directly to this email. If you need further assistance, please contact us through our{' '}
          <Link href={helpCentreUrl} style={footerNoticeLink}>
            Help and Support page
          </Link>
          .
        </>
      )}
    </Text>
  </Section>
);

// ── Typography & Base Styles ───────────────────────────────────────────────

export const heading = {
  fontSize: '21px',
  fontWeight: '700',
  color: '#0f172a',
  letterSpacing: '-0.02em',
  margin: '0 0 16px',
  textAlign: 'center' as const,
};

export const text = {
  fontSize: '15px',
  lineHeight: '24px',
  color: '#334155',
  margin: '0 0 16px',
};

export const mutedText = {
  fontSize: '13.5px',
  lineHeight: '22px',
  color: '#64748b',
  margin: '0 0 14px',
};

// ── Support ID Pill Styles ──────────────────────────────────────────────────

const idCardStyle = {
  backgroundColor: '#f1f5f9',
  border: '1px solid #e2e8f0',
  borderRadius: '10px',
  padding: '12px 20px',
  margin: '18px 0 20px',
  textAlign: 'center' as const,
};

const idLabelCell = {
  color: '#475569',
  fontSize: '14px',
  fontWeight: '500',
  paddingRight: '8px',
  verticalAlign: 'middle' as const,
};

const idValueCell = {
  color: '#2563eb',
  fontSize: '16px',
  fontWeight: '700',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  letterSpacing: '0.04em',
  verticalAlign: 'middle' as const,
};

// ── Support Summary Box Styles ──────────────────────────────────────────────

const summaryBox = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  overflow: 'hidden',
  margin: '22px 0 20px',
  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
};

const summaryHeader = {
  backgroundColor: '#f8fafc',
  padding: '11px 18px',
  borderBottom: '1px solid #e2e8f0',
};

const summaryTitle = {
  fontSize: '11.5px',
  fontWeight: '700',
  color: '#475569',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.07em',
  margin: 0,
};

const rowBorder = {
  borderBottom: '1px solid #f1f5f9',
};

const summaryLabel = {
  color: '#64748b',
  fontSize: '13.5px',
  fontWeight: '500',
  lineHeight: '20px',
  padding: '12px 18px',
  width: '130px',
  verticalAlign: 'top' as const,
};

const summaryValue = {
  color: '#0f172a',
  fontSize: '14px',
  lineHeight: '21px',
  fontWeight: '600',
  padding: '12px 18px',
  verticalAlign: 'top' as const,
};

const summaryLabelLast = {
  ...summaryLabel,
  padding: '14px 18px 16px',
};

const summaryValueLast = {
  ...summaryValue,
  padding: '14px 18px 16px',
};

const descriptionContent = {
  color: '#1e293b',
  fontSize: '14px',
  lineHeight: '22px',
  fontWeight: '400',
  backgroundColor: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '12px 14px',
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
};

// ── Attachments Box Styles ──────────────────────────────────────────────────

const attachmentsBox = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  overflow: 'hidden',
  margin: '18px 0 20px',
  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
};

const attachmentsHeader = {
  backgroundColor: '#f8fafc',
  padding: '11px 18px',
  borderBottom: '1px solid #e2e8f0',
};

const attachmentsTitle = {
  fontSize: '11.5px',
  fontWeight: '700',
  color: '#475569',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.07em',
  margin: 0,
};

const attachmentsBody = {
  padding: '6px 18px',
};

const attachmentRowBorder = {
  borderBottom: '1px solid #f1f5f9',
};

const attachmentIconCell = {
  width: '28px',
  verticalAlign: 'middle' as const,
  padding: '10px 0',
};

const attachmentIconBadge = {
  fontSize: '14px',
  display: 'inline-block',
};

const attachmentInfoCell = {
  verticalAlign: 'middle' as const,
  padding: '10px 10px',
};

const attachmentNameText = {
  color: '#0f172a',
  fontSize: '13.5px',
  fontWeight: '600',
  lineHeight: '19px',
  wordBreak: 'break-all' as const,
};

const attachmentSizeText = {
  color: '#64748b',
  fontSize: '12px',
  lineHeight: '16px',
  marginTop: '2px',
};

const attachmentActionCell = {
  textAlign: 'right' as const,
  verticalAlign: 'middle' as const,
  padding: '10px 0',
  width: '90px',
};

const attachmentViewButton = {
  backgroundColor: '#eff6ff',
  border: '1px solid #bfdbfe',
  borderRadius: '6px',
  color: '#2563eb',
  fontSize: '12.5px',
  fontWeight: '600',
  textDecoration: 'none',
  padding: '6px 12px',
  display: 'inline-block',
  textAlign: 'center' as const,
};

const attachmentAttachedLabel = {
  color: '#64748b',
  fontSize: '12px',
  fontWeight: '500',
};

// ── Footer Styles ───────────────────────────────────────────────────────────

const footerSection = {
  margin: '24px 0 0',
};

const subtleDivider = {
  borderColor: '#f1f5f9',
  margin: '24px 0 16px',
};

const footerNoticeText = {
  color: '#94a3b8',
  fontSize: '12.5px',
  lineHeight: '19px',
  textAlign: 'center' as const,
  margin: '0',
};

const footerNoticeLink = {
  color: '#2563eb',
  textDecoration: 'underline',
  fontWeight: '500',
};
