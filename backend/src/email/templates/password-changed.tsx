import * as React from 'react';
import { Heading, Text, Section } from '@react-email/components';
import { BaseLayout } from './components/BaseLayout';
import { SITE_CONFIG } from '../../config/site.config';

interface PasswordChangedEmailProps {
  name?: string;
  time?: string;
  device?: string;
  ip?: string;
}

export const PasswordChangedEmail = ({
  name = 'there',
  time = 'Just now',
  device = 'Unknown Device',
  ip = 'Unknown IP',
}: PasswordChangedEmailProps) => {
  return (
    <BaseLayout previewText="Your Meetifyy password has been changed">
      <Heading style={heading}>
        Password Changed
      </Heading>

      <Text style={text}>Hi {name},</Text>
      <Text style={text}>
        This is a confirmation that the password for your Meetifyy account was just changed.
      </Text>

      <Section style={detailsBox}>
        <Text style={detailsTitle}>Change Details</Text>
        <table role="presentation" border={0} cellPadding={0} cellSpacing={0} style={{ width: '100%' }}>
          <tbody>
            <tr>
              <td style={detailLabel}>Time</td>
              <td style={detailValue}>{time}</td>
            </tr>
            <tr>
              <td style={detailLabel}>Device</td>
              <td style={detailValue}>{device}</td>
            </tr>
            <tr>
              <td style={detailLabel}>IP Address</td>
              <td style={detailValue}>{ip}</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Text style={text}>
        <strong>Didn't make this change?</strong>
        <br />
        Please reset your password immediately or contact support at{' '}
        {SITE_CONFIG.supportUrl ? (
          <a href={SITE_CONFIG.supportUrl} style={{ color: '#050F24', textDecoration: 'underline' }}>
            {SITE_CONFIG.supportUrl.replace(/^https?:\/\//, '')}
          </a>
        ) : (
          <a href={`mailto:${SITE_CONFIG.supportEmail}`} style={{ color: '#050F24', textDecoration: 'underline' }}>
            {SITE_CONFIG.supportEmail}
          </a>
        )}{' '}
        if you need help securing your account.
      </Text>

      <Text style={text}>
        Thanks,<br />
        <strong>The Meetifyy Team</strong>
      </Text>
    </BaseLayout>
  );
};

const heading = {
  fontSize: '24px',
  fontWeight: 'bold',
  color: '#050F24',
  marginBottom: '20px',
  textAlign: 'center' as const,
};

const text = {
  fontSize: '16px',
  lineHeight: '24px',
  color: '#050F24',
  marginBottom: '16px',
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
  width: '100px',
  verticalAlign: 'top',
};

const detailValue = {
  color: '#050F24',
  fontSize: '14px',
  lineHeight: '24px',
  fontWeight: '500',
  verticalAlign: 'top',
};

export default PasswordChangedEmail;
