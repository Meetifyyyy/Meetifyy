import * as React from 'react';
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from '@react-email/components';

import { SITE_CONFIG } from '../../common/config/site.config';

interface PasswordChangedEmailProps {
  name?: string;
  time?: string;
  device?: string;
  ip?: string;
  frontendUrl?: string;
  logoUrl?: string;
}

export const PasswordChangedEmail: React.FC<Readonly<PasswordChangedEmailProps>> = ({
  name = 'User',
  time = 'Unknown',
  device = 'Unknown device',
  ip = 'Unknown',
  frontendUrl = SITE_CONFIG.frontendUrl,
  logoUrl = SITE_CONFIG.logoUrl,
}) => {
  return (
    <Html>
      <Head />
      <Preview>Your Meetifyy Password Was Changed</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Img
              src={logoUrl}
              width="48"
              height="48"
              alt="Meetifyy Logo"
              style={logoImg}
            />
            <Heading style={logoText}>Meetifyy</Heading>
          </Section>

          <Section style={content}>
            <Heading style={heading}>Your Password Has Been Changed</Heading>
            <Text style={paragraph}>Hi {name},</Text>
            <Text style={paragraph}>
              This is a confirmation that the password for your Meetifyy account was successfully changed.
            </Text>

            <Section style={infoBox}>
              <Text style={infoTitle}>Change Details</Text>
              <Text style={listItem}>• <strong>Time:</strong> {time}</Text>
              <Text style={listItem}>• <strong>Device:</strong> {device}</Text>
              <Text style={listItem}>• <strong>IP Address:</strong> {ip}</Text>
            </Section>
            
            <Text style={paragraph}>
              If you made this change, no further action is required.
            </Text>

            <Text style={paragraph}>
              If you did <strong>not</strong> change your password, your account may be at risk. Please reset your password immediately and contact support if you need assistance.
            </Text>

            <Text style={signature}>
              — <strong>The Meetifyy Team</strong>
            </Text>
          </Section>

          <Hr style={hr} />

          <Section style={footer}>
            <Text style={footerText}>
              Meetifyy • Connecting People & Communities
            </Text>
            <Text style={footerLinks}>
              <a href={SITE_CONFIG.privacyUrl} style={link}>Privacy Policy</a>
              {' • '}
              <a href={SITE_CONFIG.termsUrl} style={link}>Terms of Service</a>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

export default PasswordChangedEmail;

// Standard User Email Styles
const main = {
  backgroundColor: '#f8fafc',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  padding: '40px 0',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '0',
  borderRadius: '16px',
  boxShadow: '0 10px 35px rgba(15, 23, 42, 0.08)',
  maxWidth: '520px',
  overflow: 'hidden',
  border: '1px solid #e2e8f0',
};

const header = {
  backgroundColor: '#ffffff',
  padding: '36px 40px 16px',
  textAlign: 'center' as const,
  borderBottom: '1px solid #f1f5f9',
};

const logoImg = {
  margin: '0 auto 10px',
  display: 'block',
  width: '56px',
  height: '56px',
};

const logoText = {
  color: '#0f172a',
  fontSize: '28px',
  fontWeight: '800',
  letterSpacing: '-0.5px',
  margin: '0',
};

const content = {
  padding: '40px',
};

const heading = {
  fontSize: '22px',
  letterSpacing: '-0.5px',
  lineHeight: '1.3',
  fontWeight: '700',
  color: '#0f172a',
  margin: '0 0 20px',
  textAlign: 'center' as const,
};

const paragraph = {
  margin: '0 0 16px',
  fontSize: '15px',
  lineHeight: '25px',
  color: '#334155',
};

const infoBox = {
  backgroundColor: '#f1f5f9',
  border: '1px solid #cbd5e1',
  borderRadius: '12px',
  padding: '20px 24px',
  margin: '24px 0',
};

const infoTitle = {
  margin: '0 0 12px',
  fontSize: '14px',
  fontWeight: '700',
  color: '#0f172a',
};

const listItem = {
  margin: '0 0 8px',
  fontSize: '14px',
  lineHeight: '22px',
  color: '#334155',
};

const signature = {
  margin: '28px 0 0',
  fontSize: '15px',
  lineHeight: '24px',
  color: '#475569',
};

const hr = {
  borderColor: '#f1f5f9',
  margin: '0',
  borderWidth: '1px',
};

const footer = {
  padding: '24px 40px',
  backgroundColor: '#f8fafc',
  textAlign: 'center' as const,
};

const footerText = {
  color: '#94a3b8',
  fontSize: '13px',
  lineHeight: '20px',
  margin: '0 0 6px',
};

const footerLinks = {
  margin: '0',
  color: '#94a3b8',
  fontSize: '13px',
};

const link = {
  color: '#64748b',
  textDecoration: 'underline',
};


