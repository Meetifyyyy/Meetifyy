import * as React from 'react';
import { Heading, Text, Section } from '@react-email/components';
import { BaseLayout } from './components/BaseLayout';
import { ButtonCTA } from './components/ButtonCTA';
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
  return (
    <BaseLayout previewText="New login to your Meetifyy account detected">
      <Heading style={heading}>
        New login detected
      </Heading>

      <Text style={text}>Hi {name}! 👋</Text>
      <Text style={text}>
        Your Meetifyy account was accessed from a new device. Review the session details below.
      </Text>

      <Section style={detailsBox}>
        <Text style={detailsTitle}>Session Details</Text>
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
              <td style={detailLabel}>Browser</td>
              <td style={detailValue}>{browser} ({os})</td>
            </tr>
            <tr>
              <td style={detailLabel}>IP / Location</td>
              <td style={detailValue}>{ip || location}</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Text style={text}>
        <strong>Don't recognize this activity?</strong>
        <br />
        Change your password immediately to protect your account. Reach out to{' '}
        {SITE_CONFIG.supportUrl ? (
          <a href={SITE_CONFIG.supportUrl} style={{ color: '#050F24', textDecoration: 'underline' }}>
            support
          </a>
        ) : (
          <a href={`mailto:${SITE_CONFIG.supportEmail}`} style={{ color: '#050F24', textDecoration: 'underline' }}>
            support
          </a>
        )}{' '}
        if you need help.
      </Text>


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

export default NewLoginEmail;
