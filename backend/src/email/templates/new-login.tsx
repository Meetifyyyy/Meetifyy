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

interface NewLoginEmailProps {
  name: string;
  device: string;
  location: string;
  time: string;
}

export const NewLoginEmail = ({
  name = 'User',
  device = 'Chrome on Mac OS',
  location = 'Unknown Location',
  time = 'Just now',
}: NewLoginEmailProps) => {
  return (
    <Html>
      <Head>
      </Head>
      <Preview>New login to your Meetifyy account</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={logoText}>Meetifyy</Heading>
          </Section>
          
          <Section style={content}>
            <Heading style={heading}>New Login Detected</Heading>
            <Text style={paragraph}>Hi {name},</Text>
            <Text style={paragraph}>
              We noticed a new login to your Meetifyy account from a device we haven't seen recently.
            </Text>
            
            <Section style={infoContainer}>
              <Text style={infoText}>
                <strong>Device:</strong> {device}
                <br />
                <strong>Location:</strong> {location}
                <br />
                <strong>Time:</strong> {time}
              </Text>
            </Section>
            
            <Text style={paragraph}>
              If this was you, you can safely ignore this email. If you don't recognize this activity, please secure your account by resetting your password immediately.
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

const infoContainer = {
  backgroundColor: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '16px 20px',
  margin: '24px 0',
};

const infoText = {
  margin: '0',
  fontSize: '15px',
  lineHeight: '28px',
  color: '#1e293b',
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

export default NewLoginEmail;
