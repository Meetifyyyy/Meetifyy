import * as React from 'react';
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';

interface VerificationOtpEmailProps {
  name: string;
  otp: string;
}

export const VerificationOtpEmail = ({
  name = 'Student',
  otp = '123456',
}: VerificationOtpEmailProps) => {
  return (
    <Html>
      <Head>
      </Head>
      <Preview>Your Meetifyy Verification Code</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={logoText}>Meetifyy</Heading>
          </Section>
          
          <Section style={content}>
            <Heading style={heading}>Verify your college email</Heading>
            <Text style={paragraph}>Hi {name},</Text>
            <Text style={paragraph}>
              Welcome to Meetifyy! You're almost ready to start connecting with your campus. Please use the verification code below to confirm your email address.
            </Text>
            
            <Section style={otpWrapper}>
              <Text style={otpText}>{otp}</Text>
            </Section>
            
            <Section style={warningContainer}>
              <Text style={warningText}>
                <strong>Security Notice:</strong> Do not share this code with anyone. Our team will never ask you for this code.
              </Text>
            </Section>
            
            <Text style={paragraph}>
              This code will expire in a few minutes. If you did not request this, you can safely ignore this email.
            </Text>
            <Text style={signature}>
              Best,<br />
              The Meetifyy Team
            </Text>
          </Section>
          
          <Hr style={hr} />
          
          <Section style={footer}>
            <Text style={footerText}>
              Meetifyy, Inc. • Connecting students globally
            </Text>
            <Text style={footerLinks}>
              <a href="https://meetifyy.com/privacy" style={link}>Privacy Policy</a>
              {' • '}
              <a href="https://meetifyy.com/terms" style={link}>Terms of Service</a>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

// Styles
const main = {
  backgroundColor: '#f3f4f6',
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
  padding: '40px 0',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '0',
  borderRadius: '12px',
  boxShadow: '0 8px 30px rgba(0, 0, 0, 0.04)',
  overflow: 'hidden',
  maxWidth: '500px',
};

const header = {
  backgroundColor: '#4f46e5', // A vibrant indigo/purple
  padding: '30px 40px',
  textAlign: 'center' as const,
};

const logoText = {
  color: '#ffffff',
  fontSize: '32px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontWeight: '700',
  letterSpacing: '1px',
  margin: '0',
};

const content = {
  padding: '40px',
};

const heading = {
  fontSize: '24px',
  letterSpacing: '-0.5px',
  lineHeight: '1.3',
  fontWeight: '700',
  color: '#111827',
  margin: '0 0 20px',
  textAlign: 'center' as const,
};

const paragraph = {
  margin: '0 0 16px',
  fontSize: '16px',
  lineHeight: '26px',
  color: '#4b5563',
};

const otpWrapper = {
  backgroundColor: '#f8fafc',
  border: '2px dashed #cbd5e1',
  borderRadius: '12px',
  padding: '24px',
  margin: '32px 0',
  textAlign: 'center' as const,
};

const otpText = {
  fontSize: '48px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  fontWeight: '600',
  letterSpacing: '8px',
  color: '#4f46e5',
  margin: '0',
};

const warningContainer = {
  backgroundColor: '#fef2f2',
  borderLeft: '4px solid #ef4444',
  borderRadius: '4px',
  padding: '12px 16px',
  margin: '0 0 24px',
};

const warningText = {
  margin: '0',
  fontSize: '14px',
  lineHeight: '20px',
  color: '#991b1b',
};

const signature = {
  margin: '32px 0 0',
  fontSize: '16px',
  lineHeight: '26px',
  color: '#4b5563',
};

const hr = {
  borderColor: '#e5e7eb',
  margin: '0',
  borderWidth: '1px',
};

const footer = {
  padding: '24px 40px',
  backgroundColor: '#f9fafb',
  textAlign: 'center' as const,
};

const footerText = {
  color: '#9ca3af',
  fontSize: '13px',
  lineHeight: '20px',
  margin: '0 0 8px',
};

const footerLinks = {
  margin: '0',
  color: '#9ca3af',
  fontSize: '13px',
};

const link = {
  color: '#6b7280',
  textDecoration: 'underline',
};

export default VerificationOtpEmail;
