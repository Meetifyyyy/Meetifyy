import { Html, Head, Preview, Body, Container, Section, Text, Img } from '@react-email/components';
import * as React from 'react';

interface PasswordChangedEmailProps {
  name: string;
}

export const PasswordChangedEmail: React.FC<Readonly<PasswordChangedEmailProps>> = ({
  name = 'User',
}) => {
  return (
    <Html>
      <Head>
      </Head>
      <Preview>Your Meetifyy password has been changed successfully.</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <Text style={logoText}>Meetifyy</Text>
          </Section>

          {/* Content */}
          <Section style={content}>
            <Text style={heading}>Password Updated!</Text>
            <Text style={paragraph}>
              Hey {name},
            </Text>
            <Text style={paragraph}>
              This is a quick confirmation that the password for your Meetifyy account has been successfully changed.
            </Text>
            <Text style={paragraph}>
              If you made this change, you can safely ignore this email.
            </Text>
            <Text style={alertParagraph}>
              <strong>Didn't change your password?</strong><br />
              Please secure your account immediately by resetting your password and contacting our support team.
            </Text>
          </Section>

          {/* Footer */}
          <Section style={footer}>
            <Text style={footerText}>
              Sent by Meetifyy<br />
              The Campus Community Platform
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

export default PasswordChangedEmail;

// Styles
const main = {
  backgroundColor: '#f6f9fc',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  padding: '40px 0',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '0',
  borderRadius: '16px',
  boxShadow: '0 4px 24px rgba(0, 0, 0, 0.05)',
  maxWidth: '600px',
  overflow: 'hidden',
};

const header = {
  backgroundColor: '#4f46e5',
  padding: '40px 48px',
  textAlign: 'center' as const,
};

const logoText = {
  color: '#ffffff',
  fontSize: '36px',
  fontWeight: '400',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  margin: '0',
  letterSpacing: '1px',
};

const content = {
  padding: '48px',
};

const heading = {
  fontSize: '24px',
  fontWeight: '700',
  color: '#111827',
  margin: '0 0 24px',
};

const paragraph = {
  fontSize: '16px',
  lineHeight: '26px',
  color: '#4b5563',
  margin: '0 0 24px',
};

const alertParagraph = {
  fontSize: '15px',
  lineHeight: '24px',
  color: '#991b1b',
  backgroundColor: '#fef2f2',
  padding: '16px',
  borderRadius: '8px',
  borderLeft: '4px solid #ef4444',
  margin: '32px 0 0',
};

const footer = {
  backgroundColor: '#f9fafb',
  padding: '32px 48px',
  textAlign: 'center' as const,
  borderTop: '1px solid #f3f4f6',
};

const footerText = {
  fontSize: '14px',
  lineHeight: '24px',
  color: '#9ca3af',
  margin: '0',
};
