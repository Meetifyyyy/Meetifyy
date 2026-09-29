import * as React from 'react';
import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import { SITE_CONFIG } from '../../../config/site.config';
import { color, font } from './tokens';

interface BaseLayoutProps {
  previewText?: string;
  children: React.ReactNode;
}

/**
 * Narrow screens shrink the gutters and the two largest type sizes. Everything
 * else is fluid already. `!important` is required to beat inline styles.
 */
const responsiveCss = `
  @media only screen and (max-width: 620px) {
    .px { padding-left: 24px !important; padding-right: 24px !important; }
    .headline { font-size: 28px !important; line-height: 34px !important; }
    .digit { width: 40px !important; height: 50px !important; line-height: 48px !important; font-size: 23px !important; margin: 0 2px !important; }
    .stack { display: block !important; width: 100% !important; }
    .stack-label { padding-bottom: 2px !important; }
    .stack-value { padding-top: 0 !important; }
  }
`;

export const BaseLayout: React.FC<BaseLayoutProps> = ({
  previewText,
  children,
}) => {
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light only" />
        <style>{responsiveCss}</style>
      </Head>
      {previewText && <Preview>{previewText}</Preview>}
      <Body style={main}>
        <Container style={container}>
          <Section style={sheet}>
            <Section className="px" style={masthead}>
              <Img
                src={SITE_CONFIG.wordmarkUrl}
                width="140"
                alt="Meetifyy"
                style={logo}
              />
            </Section>

            <Section className="px" style={content}>
              {children}
            </Section>
          </Section>

          <Section style={footer}>
            <Text style={footerLinks}>
              <Link href={SITE_CONFIG.instagramUrl} style={footerLink}>
                Instagram
              </Link>
              <span style={dot}>·</span>
              <Link href={SITE_CONFIG.linkedinUrl} style={footerLink}>
                LinkedIn
              </Link>
              <span style={dot}>·</span>
              <Link href={SITE_CONFIG.privacyUrl} style={footerLink}>
                Privacy
              </Link>
              <span style={dot}>·</span>
              <Link href={SITE_CONFIG.termsUrl} style={footerLink}>
                Terms
              </Link>
            </Text>
            <Text style={footerCopy}>
              &copy; {new Date().getFullYear()} {SITE_CONFIG.appName}. All
              rights reserved.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

const main = {
  backgroundColor: color.page,
  fontFamily: font.sans,
  margin: 0,
  padding: '40px 12px',
};

const container = {
  margin: '0 auto',
  maxWidth: '600px',
  width: '100%',
};

const sheet = {
  backgroundColor: color.sheet,
  border: `1px solid ${color.hairline}`,
  borderRadius: '20px',
  overflow: 'hidden',
};

const masthead = {
  padding: '28px 44px 24px',
  textAlign: 'center' as const,
  borderBottom: `1px solid ${color.hairline}`,
};

const logo = {
  display: 'block',
  margin: '0 auto',
  border: 0,
};

const content = {
  padding: '40px 44px 44px',
};

const footer = {
  padding: '28px 12px 0',
  textAlign: 'center' as const,
};

const footerLinks = {
  fontFamily: font.sans,
  fontSize: '12px',
  lineHeight: '18px',
  color: color.muted,
  margin: '0 0 6px',
};

const footerLink = {
  color: color.muted,
  textDecoration: 'none',
  fontWeight: 500,
};

const dot = {
  color: color.faint,
  margin: '0 8px',
};

const footerCopy = {
  fontFamily: font.sans,
  fontSize: '12px',
  lineHeight: '18px',
  color: color.faint,
  margin: 0,
};
