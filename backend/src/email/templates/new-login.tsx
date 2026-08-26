import * as React from 'react';
import { Heading, Text, Section } from '@react-email/components';
import { BaseLayout } from './components/BaseLayout';
import { SITE_CONFIG } from '../../config/site.config';

interface NewLoginEmailProps {
  name?: string;
  device?: string;
  location?: string;
  time?: string;
  browser?: string;
  os?: string;
  ip?: string;
}

export const NewLoginEmail = ({
  name = 'there',
  device = 'MacBook Pro',
  location = 'Unknown Location',
  time = 'Just now',
  browser = 'Chrome 126',
  os = 'macOS Sonoma',
  ip = '192.168.1.1',
}: NewLoginEmailProps) => {
  const supportLink = SITE_CONFIG.supportUrl || `${SITE_CONFIG.frontendUrl}/help-and-support`;

  return (
    <BaseLayout previewText="New login to your Meetifyy account detected">
      <Heading style={heading}>
        New login detected
      </Heading>

      <Text style={text}>Hi {name},</Text>
      <Text style={text}>
        Your Meetifyy account was accessed from a new device. Review the session details below:
      </Text>

      <Section style={detailsBox}>
        <div style={detailsHeader}>
          <Text style={detailsTitle}>Session Details</Text>
        </div>
        <table role="presentation" border={0} cellPadding={0} cellSpacing={0} style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr style={rowBorder}>
              <td style={detailLabel}>Time</td>
              <td style={detailValue}>{time}</td>
            </tr>
            <tr style={rowBorder}>
              <td style={detailLabel}>Device</td>
              <td style={detailValue}>{device}</td>
            </tr>
            <tr style={rowBorder}>
              <td style={detailLabel}>Browser</td>
              <td style={detailValue}>{browser} ({os})</td>
            </tr>
            <tr>
              <td style={detailLabelLast}>IP Address</td>
              <td style={detailValueLast}>{ip || location}</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section style={securityBox}>
        <Text style={securityTitle}>Do not recognize this activity?</Text>
        <Text style={securityText}>
          Change your password immediately to protect your account. Reach out to{' '}
          <a href={supportLink} style={supportAnchor}>
            support
          </a>{' '}
          if you need assistance.
        </Text>
      </Section>

      <Text style={text}>
        If this was you, no further action is required.
      </Text>

      <Text style={text}>
        Thanks,<br />
        <strong>The Meetifyy Team</strong>
      </Text>
    </BaseLayout>
  );
};

const heading = {
  fontSize: '22px',
  fontWeight: 'bold',
  color: '#0f172a',
  marginBottom: '20px',
  textAlign: 'center' as const,
};

const text = {
  fontSize: '15px',
  lineHeight: '24px',
  color: '#334155',
  marginBottom: '16px',
};

const detailsBox = {
  backgroundColor: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  overflow: 'hidden',
  margin: '24px 0',
};

const detailsHeader = {
  backgroundColor: '#f1f5f9',
  padding: '10px 18px',
  borderBottom: '1px solid #e2e8f0',
};

const detailsTitle = {
  fontSize: '11px',
  fontWeight: '700',
  color: '#475569',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.08em',
  margin: 0,
};

const rowBorder = {
  borderBottom: '1px solid #f1f5f9',
};

const detailLabel = {
  color: '#64748b',
  fontSize: '13px',
  fontWeight: '500',
  lineHeight: '20px',
  padding: '10px 18px',
  width: '130px',
  verticalAlign: 'middle' as const,
};

const detailValue = {
  color: '#0f172a',
  fontSize: '13.5px',
  lineHeight: '20px',
  fontWeight: '600',
  padding: '10px 18px',
  verticalAlign: 'middle' as const,
};

const detailLabelLast = {
  ...detailLabel,
  padding: '10px 18px 12px',
};

const detailValueLast = {
  ...detailValue,
  padding: '10px 18px 12px',
};

const securityBox = {
  backgroundColor: '#eff6ff',
  border: '1px solid #dbeafe',
  borderLeft: '4px solid #2563eb',
  borderRadius: '10px',
  padding: '14px 18px',
  margin: '20px 0',
};

const securityTitle = {
  fontSize: '13.5px',
  fontWeight: '700',
  color: '#1e40af',
  margin: '0 0 4px',
};

const securityText = {
  fontSize: '13.5px',
  lineHeight: '20px',
  color: '#1e3a8a',
  margin: 0,
};

const supportAnchor = {
  color: '#2563eb',
  textDecoration: 'underline',
  fontWeight: '600',
};

export default NewLoginEmail;
