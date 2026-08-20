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
import * as S from './_shared-styles';

interface VerificationOtpEmailProps {
  name?: string;
  otp?: string;
  frontendUrl?: string;
  logoIconUrl?: string;
  instagramUrl?: string;
  twitterUrl?: string;
  linkedinUrl?: string;
}

export const VerificationOtpEmail = ({
  name = 'there',
  otp = '',
  frontendUrl = SITE_CONFIG.frontendUrl,
  logoIconUrl = SITE_CONFIG.logoIconUrl,
  instagramUrl = SITE_CONFIG.instagramUrl,
  twitterUrl = SITE_CONFIG.twitterUrl,
  linkedinUrl = SITE_CONFIG.linkedinUrl,
}: VerificationOtpEmailProps) => {
  const isTemplate = otp?.includes('{{');
  const digits = isTemplate ? [] : (otp || '').slice(0, 6).split('');

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style>{S.SHARED_HEAD_CSS}</style>
      </Head>
      <Preview>Your Meetifyy verification code: {otp}</Preview>
      <Body style={S.main} className="email-body">
        <Container style={S.container} className="email-container">

          {/* ── Header: icon + HTML text wordmark ── */}
          <Section style={S.header}>
            <a href={frontendUrl} target="_blank" rel="noopener noreferrer" style={S.headerLink}>
              <table role="presentation" border={0} cellPadding={0} cellSpacing={0} style={S.logoTable}>
                <tbody>
                  <tr>
                    <td style={S.logoIconCell}>
                      <Img
                        src={logoIconUrl}
                        width="36"
                        height="36"
                        alt="Meetifyy"
                        style={S.logoIconImg}
                      />
                    </td>
                    <td style={S.logoTextCell}>
                      <span style={S.wordmarkText}>
                        MEETIF<span style={S.wordmarkAccent}>YY</span>
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </a>
          </Section>

          {/* ── Body ── */}
          <Section style={S.content}>
            <Heading style={S.heading}>
              Your <span style={S.highlightText}>verification code</span>
            </Heading>

            <Text style={S.greeting}>Hi {name}! 👋</Text>
            <Text style={S.subtext}>
              We received a request to verify your email address.<br />
              Enter the code below to complete verification.
            </Text>

            {/* OTP Grid */}
            <Section style={otpContainer}>
              {isTemplate ? (
                <div style={templateOtpBox}>
                  <span style={digitChar}>{otp}</span>
                </div>
              ) : (
                <table
                  role="presentation"
                  border={0}
                  cellPadding={0}
                  cellSpacing={0}
                  style={digitTable}
                >
                  <tbody>
                    <tr>
                      {digits.map((digit, idx) => (
                        <td
                          key={idx}
                          style={{
                            ...digitCell,
                            ...(idx === digits.length - 1 ? { borderRight: 'none' } : {}),
                          }}
                        >
                          <span style={digitChar}>{digit}</span>
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              )}
            </Section>

            {/* Expiry */}
            <Section style={S.expirySection}>
              <Text style={S.expiryText}>
                ⏱ This code expires in <span style={S.expiryHighlight}>10 minutes</span>
              </Text>
            </Section>

            {/* Security card */}
            <Section style={S.securityCard}>
              <table role="presentation" border={0} cellPadding={0} cellSpacing={0} style={{ width: '100%' }}>
                <tbody>
                  <tr>
                    <td style={S.shieldIconCell}>
                      <div style={S.shieldBadge}>
                        <Img src={SITE_CONFIG.iconShieldUrl} width="18" height="18" alt="Shield" style={{ display: 'block', margin: '7px auto' }} />
                      </div>
                    </td>
                    <td style={S.securityTextCell}>
                      <Text style={S.securityTitle}>Keep your code private</Text>
                      <Text style={S.securityBody}>
                        Never share this code with anyone.<br />
                        Meetifyy will never ask for it.
                      </Text>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>

            <Text style={S.ignoreText}>
              If you didn't request this code, you can safely ignore this email.
            </Text>

            <Text style={S.signoff}>
              Thanks,<br />
              <strong>The Meetifyy Team</strong>
            </Text>
          </Section>

          <Hr style={S.hr} />

          {/* ── Footer ── */}
          <Section style={S.footer}>
            <table role="presentation" border={0} cellPadding={0} cellSpacing={0} style={S.socialTable}>
              <tbody>
                <tr>
                  <td style={S.socialTd}>
                    <a href={instagramUrl} target="_blank" rel="noopener noreferrer" style={S.socialBubble} title="Instagram">
                      <Img src={SITE_CONFIG.iconInstagramUrl} width="20" height="20" alt="Instagram" style={S.iconImg} />
                    </a>
                  </td>
                  <td style={S.socialTd}>
                    <a href={linkedinUrl} target="_blank" rel="noopener noreferrer" style={S.socialBubble} title="LinkedIn">
                      <Img src={SITE_CONFIG.iconLinkedinUrl} width="20" height="20" alt="LinkedIn" style={{ ...S.iconImg, borderRadius: '50%' }} />
                    </a>
                  </td>
                  <td style={S.socialTd}>
                    <a href={frontendUrl} target="_blank" rel="noopener noreferrer" style={S.socialBubble} title="Website">
                      <Img src={SITE_CONFIG.iconWebsiteUrl} width="20" height="20" alt="Website" style={S.iconImg} />
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>
            <Text style={S.copyright}>© {new Date().getFullYear()} Meetifyy. All rights reserved.</Text>
            <Text style={S.subFooter}>Meetifyy Inc — Building adventures, connecting people.</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

// ── OTP-specific styles ──────────────────────────────────────────────────────

const otpContainer = {
  margin: '0 0 16px',
};

const templateOtpBox = {
  width: '100%',
  border: '1px solid #e2e8f0',
  borderRadius: '14px',
  backgroundColor: '#f8f7ff',
  padding: '18px 0',
  textAlign: 'center' as const,
};

const digitTable = {
  width: '100%',
  borderCollapse: 'separate' as const,
  borderSpacing: '0',
  border: '1px solid #e2e8f0',
  borderRadius: '14px',
  backgroundColor: '#f8f7ff',
  overflow: 'hidden',
};

const digitCell = {
  width: '16.66%',
  height: '68px',
  textAlign: 'center' as const,
  verticalAlign: 'middle' as const,
  borderRight: '1px solid #e2e8f0',
  backgroundColor: '#f8f7ff',
};

const digitChar = {
  fontSize: '30px',
  fontWeight: '700',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  color: '#4f46e5',
};

export default VerificationOtpEmail;
