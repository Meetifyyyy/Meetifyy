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
  logoWhiteUrl?: string;
  instagramUrl?: string;
  twitterUrl?: string;
  linkedinUrl?: string;
}

export const WelcomeEmail = ({
  name = 'there',
  frontendUrl = SITE_CONFIG.frontendUrl,
  logoUrl = SITE_CONFIG.logoUrl,
  logoWhiteUrl = SITE_CONFIG.logoWhiteUrl,
  instagramUrl = SITE_CONFIG.instagramUrl,
  twitterUrl = SITE_CONFIG.twitterUrl,
  linkedinUrl = SITE_CONFIG.linkedinUrl,
}: WelcomeEmailProps) => {
  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="only light" />
        <meta name="supported-color-schemes" content="only light" />
        <style>{`
          :root {
            color-scheme: light !important;
            supported-color-schemes: light !important;
          }
          html, body, .body {
            background-color: transparent !important;
            color-scheme: light !important;
          }
          .light-container {
            background-color: #ffffff !important;
          }
          @media (prefers-color-scheme: dark) {
            html, body, .body {
              background-color: transparent !important;
            }
            .light-container {
              background-color: #ffffff !important;
            }
          }
          u + .body {
            background-color: transparent !important;
          }
          u + .body .light-container {
            background-color: #ffffff !important;
          }
          [data-ogsc] body,
          body[data-outlook-cycle] {
            background-color: transparent !important;
          }
          [data-ogsc] .light-container {
            background-color: #ffffff !important;
          }
        `}</style>
      </Head>
      <Preview>Welcome to Meetifyy! 👋</Preview>
      <Body style={main}>
        <Container style={container} className="light-container">
          <Section style={header}>
            <a href={frontendUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', display: 'inline-block' }}>
              <Img
                src={logoUrl}
                width="170"
                alt="Meetifyy"
                style={logoImg}
              />
            </a>
          </Section>

          <Section style={content}>
            <Heading style={heading}>
              Welcome to <span style={highlightText}>Meetifyy</span> 👋
            </Heading>

            <Text style={greeting}>Hi {name}! 🎉</Text>
            <Text style={subtext}>
              We're thrilled to have you join our community.<br />
              Meetifyy helps you discover activities and build real connections.
            </Text>

            {/* Next Steps Box */}
            <Section style={stepsBox}>
              <Text style={stepsTitle}>What you can do next:</Text>
              <Text style={stepItem}>1. Complete your profile setup</Text>
              <Text style={stepItem}>2. Explore activities near your location</Text>
              <Text style={stepItem}>3. Join groups matching your interests</Text>
              <Text style={stepItem}>4. Connect and make lasting friendships</Text>
            </Section>

            {/* CTA Button */}
            <Section style={btnSection}>
              <Button style={button} href={`${frontendUrl}/home`}>
                Explore Meetifyy →
              </Button>
            </Section>

            {/* Security/Community Notice Card */}
            <Section style={securityCard}>
              <table role="presentation" border={0} cellPadding={0} cellSpacing={0} style={{ width: '100%' }}>
                <tbody>
                  <tr>
                    <td style={shieldIconCell}>
                      <div style={shieldBadge}>
                        <Img src={SITE_CONFIG.iconShieldUrl} width="20" height="20" alt="Shield" style={{ display: 'block', margin: '7px auto' }} />
                      </div>
                    </td>
                    <td style={securityTextCell}>
                      <Text style={securityTitle}>Safe Community</Text>
                      <Text style={securityBody}>
                        We prioritize safety across all Meetifyy events.<br />
                        Always follow community guidelines.
                      </Text>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>

            <Text style={signoff}>
              Thanks,<br />
              The Meetifyy Team
            </Text>
          </Section>

          <Hr style={hr} />

          <Section style={footer}>
            <table role="presentation" border={0} cellPadding={0} cellSpacing={0} style={socialTable}>
              <tbody>
                <tr>
                  <td style={socialTd}>
                    <a href={instagramUrl} target="_blank" rel="noopener noreferrer" style={socialBubble} title="Instagram">
                      <Img src={SITE_CONFIG.iconInstagramUrl} width="20" height="20" alt="Instagram" style={iconImg} />
                    </a>
                  </td>
                  <td style={socialTd}>
                    <a href={linkedinUrl} target="_blank" rel="noopener noreferrer" style={socialBubble} title="LinkedIn">
                      <Img src={SITE_CONFIG.iconLinkedinUrl} width="20" height="20" alt="LinkedIn" style={{ ...iconImg, borderRadius: '50%' }} />
                    </a>
                  </td>
                  <td style={socialTd}>
                    <a href={frontendUrl} target="_blank" rel="noopener noreferrer" style={socialBubble} title="Website">
                      <Img src={SITE_CONFIG.iconWebsiteUrl} width="20" height="20" alt="Website" style={iconImg} />
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>

            <Text style={copyright}>
              © {new Date().getFullYear()} Meetifyy. All rights reserved.
            </Text>
            <Text style={subFooter}>
              Meetifyy Inc, Building adventures, connecting people.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

// Content styles identical to verification-otp.tsx
const main = {
  backgroundColor: 'transparent',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif',
  padding: '44px 0',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '0',
  borderRadius: '24px',
  boxShadow: '0 10px 30px rgba(15, 23, 42, 0.04)',
  overflow: 'hidden',
  maxWidth: '460px',
  border: '1px solid #f1f5f9',
};

const header = {
  backgroundColor: '#ffffff',
  padding: '44px 40px 16px',
  textAlign: 'center' as const,
};

const logoImg = {
  margin: '0 auto',
  display: 'block',
  maxWidth: '190px',
  width: '170px',
  height: 'auto',
};

const content = {
  padding: '36px 40px 32px',
  textAlign: 'center' as const,
};

const heading = {
  fontSize: '26px',
  fontWeight: '600',
  letterSpacing: '-0.4px',
  color: '#1e293b',
  margin: '12px 0 16px',
  textAlign: 'center' as const,
};

const highlightText = {
  color: '#4f46e5',
  fontWeight: '600',
};

const greeting = {
  fontSize: '15px',
  fontWeight: '500',
  color: '#475569',
  margin: '0 0 6px',
};

const subtext = {
  fontSize: '14px',
  lineHeight: '22px',
  color: '#64748b',
  fontWeight: '400',
  margin: '0 0 24px',
};

const stepsBox = {
  backgroundColor: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '16px',
  padding: '16px 20px',
  margin: '0 0 24px',
  textAlign: 'left' as const,
};

const stepsTitle = {
  fontSize: '13px',
  fontWeight: '600',
  color: '#1e293b',
  margin: '0 0 10px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
};

const stepItem = {
  fontSize: '13px',
  lineHeight: '20px',
  color: '#475569',
  margin: '0 0 6px',
};

const btnSection = {
  margin: '0 0 24px',
  textAlign: 'center' as const,
};

const button = {
  backgroundColor: '#4f46e5',
  borderRadius: '12px',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: '600',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '14px 32px',
};

const securityCard = {
  backgroundColor: '#f5f3ff',
  borderRadius: '16px',
  padding: '16px 20px',
  margin: '0 0 24px',
  textAlign: 'left' as const,
};

const shieldIconCell = {
  width: '44px',
  verticalAlign: 'top' as const,
};

const shieldBadge = {
  width: '36px',
  height: '36px',
  borderRadius: '50%',
  backgroundColor: '#e0e7ff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center' as const,
};

const securityTextCell = {
  verticalAlign: 'top' as const,
  paddingLeft: '8px',
};

const securityTitle = {
  fontSize: '14px',
  fontWeight: '600',
  color: '#1e1b4b',
  margin: '0 0 2px',
};

const securityBody = {
  fontSize: '13px',
  lineHeight: '19px',
  color: '#64748b',
  fontWeight: '400',
  margin: '0',
};

const signoff = {
  fontSize: '14px',
  lineHeight: '22px',
  color: '#475569',
  fontWeight: '400',
  margin: '0',
  textAlign: 'center' as const,
};

const hr = {
  borderColor: '#f1f5f9',
  margin: '0',
  borderWidth: '1px',
};

const footer = {
  padding: '24px 40px 32px',
  backgroundColor: '#ffffff',
  textAlign: 'center' as const,
};

const socialTable = {
  margin: '0 auto 16px',
};

const socialTd = {
  padding: '0 8px',
  textAlign: 'center' as const,
  verticalAlign: 'middle' as const,
};

const socialBubble = {
  display: 'inline-block',
  width: '36px',
  height: '36px',
  borderRadius: '50%',
  backgroundColor: '#f8fafc',
  border: '1px solid #f1f5f9',
  textAlign: 'center' as const,
  verticalAlign: 'middle' as const,
  textDecoration: 'none',
};

const iconImg = {
  display: 'block',
  margin: '7px auto',
  width: '20px',
  height: '20px',
  border: '0',
};

const copyright = {
  fontSize: '12px',
  color: '#94a3b8',
  fontWeight: '400',
  margin: '0 0 4px',
};

const subFooter = {
  fontSize: '12px',
  color: '#cbd5e1',
  fontWeight: '400',
  margin: '0',
};

export default WelcomeEmail;
