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

interface VerificationOtpEmailProps {
  name?: string;
  otp?: string;
  frontendUrl?: string;
  logoUrl?: string;
}

export const VerificationOtpEmail = ({
  name = 'Friend',
  otp = '123456',
  frontendUrl = SITE_CONFIG.frontendUrl,
  logoUrl = SITE_CONFIG.logoUrl,
}: VerificationOtpEmailProps) => {
  return (
    <Html>
      <Head />
      <Preview>Your Meetifyy Verification Code: {otp}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <a href={frontendUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
              <Img
                src={logoUrl}
                width="48"
                height="48"
                alt="Meetifyy Logo"
                style={logoImg}
              />
            </a>
            <Heading style={logoText}>
              <a href={frontendUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
                Meetifyy
              </a>
            </Heading>
          </Section>
          
          <Section style={content}>
            <Heading style={heading}>Verify Your Email</Heading>
            <Text style={paragraph}>Hi {name},</Text>
            <Text style={paragraph}>
              Welcome to <strong>Meetifyy</strong>! Please use the 6-digit verification code below to verify your email address.
            </Text>
            
            <Section style={otpWrapper}>
              <Text style={otpText}>{otp}</Text>
            </Section>
            
            <Section style={infoBox}>
              <Text style={infoText}>
                This code will expire in <strong>10 minutes</strong>.
              </Text>
            </Section>
            
            <Text style={paragraph}>
              If you didn't request this code, you can safely ignore this email. Your account remains unverified.
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

// Standard User Email Styles
const main = {
  backgroundColor: '#f8fafc',
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
  padding: '40px 0',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '0',
  borderRadius: '16px',
  boxShadow: '0 10px 35px rgba(15, 23, 42, 0.08)',
  overflow: 'hidden',
  maxWidth: '520px',
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

const otpWrapper = {
  backgroundColor: '#f1f5f9',
  border: '2px dashed #cbd5e1',
  borderRadius: '14px',
  padding: '24px',
  margin: '24px 0',
  textAlign: 'center' as const,
};

const otpText = {
  fontSize: '44px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontWeight: '700',
  letterSpacing: '10px',
  color: '#4f46e5',
  margin: '0',
};

const infoBox = {
  backgroundColor: '#f1f5f9',
  border: '1px solid #cbd5e1',
  borderRadius: '10px',
  padding: '14px 18px',
  margin: '0 0 20px',
  textAlign: 'center' as const,
};

const infoText = {
  margin: '0',
  fontSize: '14px',
  lineHeight: '20px',
  color: '#0f172a',
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

export default VerificationOtpEmail;


