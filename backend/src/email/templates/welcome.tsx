import * as React from 'react';
import {
  Body,
  Button,
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

interface WelcomeEmailProps {
  name?: string;
  frontendUrl?: string;
  logoUrl?: string;
}

export const WelcomeEmail = ({
  name = 'Friend',
  frontendUrl = SITE_CONFIG.frontendUrl,
  logoUrl = SITE_CONFIG.logoUrl,
}: WelcomeEmailProps) => {
  return (
    <Html>
      <Head />
      <Preview>Welcome to Meetifyy! 🎉</Preview>
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
            <Heading style={heading}>Welcome to Meetifyy 👋</Heading>
            <Text style={paragraph}>Hi {name},</Text>
            <Text style={paragraph}>
              Welcome to <strong>Meetifyy</strong>! We're excited to have you join our community.
            </Text>
            <Text style={paragraph}>
              Meetifyy helps you discover activities, connect with like-minded people, and build meaningful friendships—whether it's sports, study sessions, hiking, gaming, or anything in between.
            </Text>

            <Section style={infoBox}>
              <Text style={infoTitle}>Here's what you can do next:</Text>
              <Text style={listItem}>• Complete your profile.</Text>
              <Text style={listItem}>• Explore activities near you.</Text>
              <Text style={listItem}>• Join groups that match your interests.</Text>
              <Text style={listItem}>• Meet new people and create lasting connections.</Text>
            </Section>

            <Text style={paragraph}>
              Your adventure starts now.
            </Text>

            <Section style={btnContainer}>
              <Button style={button} href={`${frontendUrl}/home`}>
                Explore Meetifyy →
              </Button>
            </Section>
            
            <Text style={signature}>
              See you on Meetifyy!<br /><br />
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

const infoBox = {
  backgroundColor: '#f1f5f9',
  borderRadius: '12px',
  padding: '20px 24px',
  margin: '24px 0',
  border: '1px solid #cbd5e1',
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

const btnContainer = {
  textAlign: 'center' as const,
  margin: '28px 0',
};

const button = {
  backgroundColor: '#4f46e5',
  borderRadius: '10px',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: '600',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '14px 32px',
  boxShadow: '0 4px 14px rgba(79, 70, 229, 0.35)',
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

export default WelcomeEmail;


