import * as React from 'react';
import { Hr, Link, Section, Text } from '@react-email/components';
import { color, font, type } from './tokens';

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
export const SupportIdPill: React.FC<{ ticketNumber: string }> = ({
  ticketNumber,
}) => (
  <Section style={idCardStyle}>
    <table
      role="presentation"
      border={0}
      cellPadding={0}
      cellSpacing={0}
      style={{ margin: '0 auto' }}
    >
      <tbody>
        <tr>
          <td style={idLabelCell}>Your Support ID:</td>
          <td style={idValueCell}>#{ticketNumber}</td>
        </tr>
      </tbody>
    </table>
  </Section>
);

/** Structured Support request summary card. */
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
        <Text style={summaryTitle}>Support request summary</Text>
      </div>

      <table
        role="presentation"
        border={0}
        cellPadding={0}
        cellSpacing={0}
        style={{ width: '100%', borderCollapse: 'collapse' }}
      >
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
          {attachments.length === 1
            ? 'Attachment'
            : `Attachments (${attachments.length})`}
        </Text>
      </div>
      <div style={attachmentsBody}>
        <table
          role="presentation"
          border={0}
          cellPadding={0}
          cellSpacing={0}
          style={{ width: '100%', borderCollapse: 'collapse' }}
        >
          <tbody>
            {attachments.map((item, index) => {
              const formattedSize = formatFileSize(item.size);
              const isLast = index === attachments.length - 1;

              return (
                <tr
                  key={`${item.filename}-${index}`}
                  style={isLast ? undefined : attachmentRowBorder}
                >
                  <td style={attachmentIconCell}>
                    <span style={attachmentIconBadge} />
                  </td>
                  <td style={attachmentInfoCell}>
                    <div style={attachmentNameText}>{item.filename}</div>
                    {formattedSize && (
                      <div style={attachmentSizeText}>{formattedSize}</div>
                    )}
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
          This is an automated confirmation email. Please do not reply directly
          to this email.
          <br />
          For further assistance, please contact us through our{' '}
          <Link href={helpCentreUrl} style={footerNoticeLink}>
            Help and Support page
          </Link>
          .
        </>
      ) : (
        <>
          Please do not reply directly to this email. If you need further
          assistance, please contact us through our{' '}
          <Link href={helpCentreUrl} style={footerNoticeLink}>
            Help and Support page
          </Link>
          .
        </>
      )}
    </Text>
  </Section>
);

// ── Typography (kept as exports for existing importers) ────────────────────

export const heading = type.headline;
export const text = type.body;
export const mutedText = type.small;

// ── Support ID ──────────────────────────────────────────────────────────────

const idCardStyle = {
  backgroundColor: color.tint,
  borderRadius: '14px',
  padding: '16px 20px',
  margin: '4px 0 24px',
  textAlign: 'center' as const,
};

const idLabelCell = {
  color: color.muted,
  fontFamily: font.sans,
  fontSize: '13px',
  fontWeight: 500,
  paddingRight: '10px',
  verticalAlign: 'middle' as const,
};

const idValueCell = {
  color: color.accent,
  fontSize: '18px',
  fontWeight: 600,
  fontFamily: font.sans,
  letterSpacing: '0.04em',
  verticalAlign: 'middle' as const,
};

// ── Request summary ─────────────────────────────────────────────────────────

const summaryBox = {
  margin: '28px 0',
};

const summaryHeader = {
  padding: '0 0 10px',
  borderBottom: `1px solid ${color.rule}`,
};

const summaryTitle = {
  ...type.label,
  margin: 0,
};

const rowBorder = {
  borderBottom: `1px solid ${color.hairline}`,
};

const summaryLabel = {
  color: color.muted,
  fontFamily: font.sans,
  fontSize: '13px',
  lineHeight: '20px',
  padding: '14px 16px 14px 0',
  width: '120px',
  verticalAlign: 'top' as const,
};

const summaryValue = {
  color: color.ink,
  fontFamily: font.sans,
  fontSize: '14px',
  lineHeight: '21px',
  fontWeight: 600,
  padding: '14px 0',
  verticalAlign: 'top' as const,
};

const summaryLabelLast = { ...summaryLabel };
const summaryValueLast = { ...summaryValue };

const descriptionContent = {
  color: color.body,
  fontFamily: font.sans,
  fontSize: '14px',
  lineHeight: '22px',
  fontWeight: 400,
  backgroundColor: color.inset,
  borderRadius: '10px',
  padding: '12px 14px',
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
};

// ── Attachments ─────────────────────────────────────────────────────────────

const attachmentsBox = {
  margin: '28px 0',
};

const attachmentsHeader = {
  padding: '0 0 10px',
  borderBottom: `1px solid ${color.rule}`,
};

const attachmentsTitle = {
  ...type.label,
  margin: 0,
};

const attachmentsBody = {
  padding: 0,
};

const attachmentRowBorder = {
  borderBottom: `1px solid ${color.hairline}`,
};

const attachmentIconCell = {
  width: '20px',
  verticalAlign: 'middle' as const,
  padding: '14px 0',
};

const attachmentIconBadge = {
  display: 'inline-block',
  width: '8px',
  height: '8px',
  borderRadius: '2px',
  backgroundColor: color.accent,
};

const attachmentInfoCell = {
  verticalAlign: 'middle' as const,
  padding: '14px 10px 14px 0',
};

const attachmentNameText = {
  color: color.ink,
  fontFamily: font.sans,
  fontSize: '14px',
  fontWeight: 600,
  lineHeight: '19px',
  wordBreak: 'break-all' as const,
};

const attachmentSizeText = {
  color: color.muted,
  fontFamily: font.sans,
  fontSize: '12px',
  lineHeight: '16px',
  marginTop: '2px',
};

const attachmentActionCell = {
  textAlign: 'right' as const,
  verticalAlign: 'middle' as const,
  padding: '14px 0',
  width: '90px',
};

const attachmentViewButton = {
  backgroundColor: color.tint,
  borderRadius: '8px',
  color: color.accent,
  fontFamily: font.sans,
  fontSize: '12.5px',
  fontWeight: 600,
  textDecoration: 'none',
  padding: '7px 13px',
  display: 'inline-block',
  textAlign: 'center' as const,
};

const attachmentAttachedLabel = {
  color: color.muted,
  fontFamily: font.sans,
  fontSize: '12px',
  fontWeight: 500,
};

// ── Footer notice ───────────────────────────────────────────────────────────

const footerSection = {
  margin: '32px 0 0',
};

const subtleDivider = {
  borderColor: color.hairline,
  margin: '0 0 18px',
};

const footerNoticeText = {
  color: color.muted,
  fontFamily: font.sans,
  fontSize: '12.5px',
  lineHeight: '19px',
  margin: '0',
};

const footerNoticeLink = {
  color: color.ink,
  textDecoration: 'underline',
  fontWeight: 600,
};
