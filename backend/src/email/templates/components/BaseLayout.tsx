import * as React from 'react';
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import { SITE_CONFIG } from '../../../config/site.config';

interface BaseLayoutProps {
  previewText?: string;
  children: React.ReactNode;
}

export const BaseLayout: React.FC<BaseLayoutProps> = ({ previewText, children }) => {
  return (
    <Html>
      <Head />
      {previewText && <Preview>{previewText}</Preview>}
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Img
              src={SITE_CONFIG.wordmarkUrl}
              width="140"
              alt="Meetifyy"
              style={logo}
            />
          </Section>
          
          <Section style={contentWrapper}>
            {children}
          </Section>

          <Hr style={divider} />
          
          <Section style={footer}>
            <Text style={footerText}>
              <Link href={SITE_CONFIG.instagramUrl} style={socialLink}>Instagram</Link>
              <span style={footerSeparator}>•</span>
              <Link href={SITE_CONFIG.linkedinUrl} style={socialLink}>LinkedIn</Link>
            </Text>
            <Text style={footerText}>
              &copy; {new Date().getFullYear()} {SITE_CONFIG.appName}. All rights reserved.<br />
              <Link href={SITE_CONFIG.privacyUrl} style={footerLink}>Privacy Policy</Link>
              <span style={footerSeparator}>•</span>
              <Link href={SITE_CONFIG.termsUrl} style={footerLink}>Terms of Service</Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

const main = {
  backgroundColor: '#f8fafc',
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif',
  padding: '36px 0',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '40px 32px',
  borderRadius: '16px',
  maxWidth: '580px',
  border: '1px solid #e2e8f0',
  boxShadow: '0 4px 20px -2px rgba(15, 23, 42, 0.05)',
};

const header = {
  padding: '0 0 32px',
  textAlign: 'center' as const,
};

const logo = {
  display: 'block',
  margin: '0 auto',
};

const contentWrapper = {
  padding: '0',
};

const divider = {
  borderColor: '#f1f5f9',
  margin: '32px 0 24px',
};

const footer = {
  textAlign: 'center' as const,
};

const footerText = {
  color: '#94a3b8',
  fontSize: '12px',
  lineHeight: '18px',
  margin: '8px 0',
};

const footerLink = {
  color: '#94a3b8',
  textDecoration: 'underline',
};

const socialLink = {
  color: '#64748b',
  textDecoration: 'none',
  fontWeight: '500',
};

const footerSeparator = {
  color: '#cbd5e1',
  margin: '0 8px',
};
