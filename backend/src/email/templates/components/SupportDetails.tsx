import * as React from 'react';
import { Section, Text } from '@react-email/components';

/**
 * Shared pieces for the three support emails (confirmation, admin
 * notification, admin reply).
 *
 * They exist as one component rather than three copies of the same table
 * markup because the support emails must stay visually identical to each other
 * and to the rest of the Meetifyy templates - the label/value table here is
 * the same construction `new-login.tsx` uses, so the whole family keeps one
 * look without any of them re-deriving it.
 */

export interface DetailRow {
  label: string;
  value: React.ReactNode;
}

export const DetailTable: React.FC<{ title?: string; rows: DetailRow[] }> = ({ title, rows }) => (
  <Section style={detailsBox}>
    {title && <Text style={detailsTitle}>{title}</Text>}
    <table role="presentation" border={0} cellPadding={0} cellSpacing={0} style={{ width: '100%' }}>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td style={detailLabel}>{row.label}</td>
            <td style={detailValue}>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </Section>
);

/**
 * The user's own words, quoted back. Rendered as pre-wrapped plain text - the
 * description is plain text and must not become markup on its way into an
 * inbox, where no CSP applies.
 */
export const QuotedBlock: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <Section style={quoteBox}>
    <Text style={detailsTitle}>{label}</Text>
    <Text style={quoteText}>{children}</Text>
  </Section>
);

/** The Request ID, given the visual weight of the thing to keep. */
export const TicketBadge: React.FC<{ ticketNumber: string }> = ({ ticketNumber }) => (
  <Section style={badgeWrap}>
    <Text style={badgeLabel}>Request ID</Text>
    <Text style={badgeValue}>{ticketNumber}</Text>
  </Section>
);

// Values below mirror the existing templates exactly (#050F24 ink, #f6f9fc
// panels, 8px radius, 600px content width from BaseLayout).
export const heading = {
  fontSize: '24px',
  fontWeight: 'bold',
  color: '#050F24',
  marginBottom: '20px',
  textAlign: 'center' as const,
};

export const text = {
  fontSize: '16px',
  lineHeight: '24px',
  color: '#050F24',
  marginBottom: '16px',
};

export const mutedText = {
  ...text,
  fontSize: '14px',
  color: '#8898aa',
};

const detailsBox = {
  backgroundColor: '#f6f9fc',
  padding: '20px',
  borderRadius: '8px',
  marginBottom: '20px',
};

const detailsTitle = {
  fontSize: '14px',
  fontWeight: 'bold',
  color: '#050F24',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  marginBottom: '12px',
};

const detailLabel = {
  color: '#8898aa',
  fontSize: '14px',
  lineHeight: '24px',
  paddingRight: '12px',
  width: '120px',
  verticalAlign: 'top' as const,
};

const detailValue = {
  color: '#050F24',
  fontSize: '14px',
  lineHeight: '24px',
  fontWeight: '500',
  verticalAlign: 'top' as const,
};

const quoteBox = {
  backgroundColor: '#ffffff',
  border: '1px solid #e6ebf1',
  borderLeft: '4px solid #2563EB',
  padding: '16px 20px',
  borderRadius: '8px',
  marginBottom: '20px',
};

const quoteText = {
  fontSize: '15px',
  lineHeight: '23px',
  color: '#050F24',
  margin: '0',
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
};

const badgeWrap = {
  backgroundColor: '#050F24',
  borderRadius: '8px',
  padding: '18px 20px',
  textAlign: 'center' as const,
  marginBottom: '24px',
};

const badgeLabel = {
  color: '#8fa3c8',
  fontSize: '12px',
  textTransform: 'uppercase' as const,
  letterSpacing: '1px',
  margin: '0 0 6px',
};

const badgeValue = {
  color: '#ffffff',
  fontSize: '26px',
  fontWeight: 'bold',
  letterSpacing: '2px',
  margin: '0',
  fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
};
