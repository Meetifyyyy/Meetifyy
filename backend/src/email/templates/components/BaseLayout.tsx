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
              width="150"
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
              <Link href={SITE_CONFIG.instagramUrl} style={socialLink}>Instagram</Link> •{' '}
              <Link href={SITE_CONFIG.twitterUrl} style={socialLink}>Twitter</Link> •{' '}
              <Link href={SITE_CONFIG.linkedinUrl} style={socialLink}>LinkedIn</Link>
            </Text>
            <Text style={footerText}>
              &copy; {new Date().getFullYear()} {SITE_CONFIG.appName}. All rights reserved.<br />
              <Link href={SITE_CONFIG.privacyUrl} style={footerLink}>Privacy Policy</Link> •{' '}
              <Link href={SITE_CONFIG.termsUrl} style={footerLink}>Terms of Service</Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

// Styles
const main = {
  backgroundColor: '#f6f9fc',
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '40px auto',
  padding: '40px 20px',
  borderRadius: '8px',
  maxWidth: '600px',
  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
};

const header = {
  padding: '0 0 30px',
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
  borderColor: '#e6ebf1',
  margin: '30px 0',
};

const footer = {
  textAlign: 'center' as const,
};

const footerText = {
  color: '#8898aa',
  fontSize: '12px',
  lineHeight: '16px',
  margin: '10px 0',
};

const footerLink = {
  color: '#8898aa',
  textDecoration: 'underline',
};

const socialLink = {
  color: '#8898aa',
  textDecoration: 'none',
  fontWeight: '500',
};
