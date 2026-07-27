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

interface AdminOtpEmailProps {
  name: string;
  otp: string;
}

export const AdminOtpEmail = ({
  name = 'Super Admin',
  otp = '123456',
}: AdminOtpEmailProps) => {
  return (
    <Html>
      <Head />
      <Preview>Super Admin Access Code: {otp}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Text style={badge}>SUPER ADMIN SECURITY</Text>
            <Heading style={logoText}>Meetifyy Admin</Heading>
          </Section>
          
          <Section style={content}>
            <Heading style={heading}>Verification Required</Heading>
            <Text style={paragraph}>Hello {name},</Text>
            <Text style={paragraph}>
              A sign-in request to the Super Admin Portal was initiated for your account. Use the 6-digit authentication code below to complete your sign in.
            </Text>
            
            <Section style={otpWrapper}>
              <Text style={otpText}>{otp}</Text>
            </Section>
            
            <Section style={warningContainer}>
              <Text style={warningText}>
                <strong>Strict Confidentiality:</strong> This code provides elevated administrative access. Never share this code with anyone under any circumstances.
              </Text>
            </Section>
            
            <Text style={paragraph}>
              This code will expire in 5 minutes. If you did not initiate this request, please audit your active sessions immediately.
            </Text>
            <Text style={signature}>
              Meetifyy Security Operations<br />
              Automated Access System
            </Text>
          </Section>
          
          <Hr style={hr} />
          
          <Section style={footer}>
            <Text style={footerText}>
              Meetifyy Super Admin Portal • Restricted System
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

// Styles
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
  borderRadius: '12px',
  boxShadow: '0 4px 20px rgba(15, 23, 42, 0.08)',
  border: '1px solid #e2e8f0',
  overflow: 'hidden',
  maxWidth: '520px',
};

const header = {
  background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
  padding: '32px 40px',
  textAlign: 'center' as const,
};

const badge = {
  display: 'inline-block',
  fontSize: '11px',
  fontWeight: '700',
  color: '#38bdf8',
  backgroundColor: 'rgba(56, 189, 248, 0.12)',
  padding: '3px 10px',
  borderRadius: '9999px',
  letterSpacing: '1.2px',
  margin: '0 0 10px',
  textTransform: 'uppercase' as const,
};

const logoText = {
  color: '#ffffff',
  fontSize: '26px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontWeight: '800',
  letterSpacing: '-0.5px',
  margin: '0',
};

const content = {
  padding: '36px 40px',
};

const heading = {
  fontSize: '22px',
  letterSpacing: '-0.5px',
  lineHeight: '1.3',
  fontWeight: '700',
  color: '#0f172a',
  margin: '0 0 16px',
};

const paragraph = {
  margin: '0 0 16px',
  fontSize: '15px',
  lineHeight: '24px',
  color: '#334155',
};

const otpWrapper = {
  backgroundColor: '#f1f5f9',
  border: '1px solid #cbd5e1',
  borderRadius: '10px',
  padding: '20px',
  margin: '24px 0',
  textAlign: 'center' as const,
};

const otpText = {
  fontSize: '42px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontWeight: '700',
  letterSpacing: '8px',
  color: '#2563eb',
  margin: '0',
};

const warningContainer = {
  backgroundColor: '#fff1f2',
  borderLeft: '4px solid #f43f5e',
  borderRadius: '6px',
  padding: '12px 16px',
  margin: '0 0 20px',
};

const warningText = {
  margin: '0',
  fontSize: '13px',
  lineHeight: '18px',
  color: '#9f1239',
};

const signature = {
  margin: '24px 0 0',
  fontSize: '14px',
  lineHeight: '22px',
  color: '#64748b',
};

const hr = {
  borderColor: '#f1f5f9',
  margin: '0',
  borderWidth: '1px',
};

const footer = {
  padding: '20px 40px',
  backgroundColor: '#f8fafc',
  textAlign: 'center' as const,
};

const footerText = {
  color: '#94a3b8',
  fontSize: '12px',
  margin: '0',
};

export default AdminOtpEmail;
