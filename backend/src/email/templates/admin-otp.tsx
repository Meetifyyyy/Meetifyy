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

interface AdminOtpEmailProps {
  name?: string;
  otp?: string;
  frontendUrl?: string;
  logoIconUrl?: string;
  instagramUrl?: string;
  twitterUrl?: string;
  linkedinUrl?: string;
}

export const AdminOtpEmail = ({
  name = 'Super Admin',
  otp = '',
  frontendUrl = SITE_CONFIG.frontendUrl,
  logoIconUrl = SITE_CONFIG.logoIconUrl,
  instagramUrl = SITE_CONFIG.instagramUrl,
  twitterUrl = SITE_CONFIG.twitterUrl,
  linkedinUrl = SITE_CONFIG.linkedinUrl,
}: AdminOtpEmailProps) => {
  const isTemplate = otp?.includes('{{');
  const digits = isTemplate ? [] : (otp || '').slice(0, 6).split('');

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style>{S.SHARED_HEAD_CSS}</style>
      </Head>
      <Preview>Super Admin Access Code: {otp}</Preview>
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
            {/* Admin badge */}
            <div style={adminBadge}>🔐 ADMIN PORTAL</div>

            <Heading style={S.heading}>
              Super Admin <span style={S.highlightText}>access code</span>
            </Heading>

            <Text style={S.greeting}>Hello {name} 👋</Text>
            <Text style={S.subtext}>
              A sign-in request to the Super Admin Portal was initiated.<br />
              Use the 6-digit authentication code below to proceed.
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

            {/* Security card — elevated warning for admin */}
            <Section style={adminSecurityCard}>
              <table role="presentation" border={0} cellPadding={0} cellSpacing={0} style={{ width: '100%' }}>
                <tbody>
                  <tr>
                    <td style={S.shieldIconCell}>
                      <div style={adminShieldBadge}>
                        <Img src={SITE_CONFIG.iconShieldUrl} width="18" height="18" alt="Shield" style={{ display: 'block', margin: '7px auto' }} />
                      </div>
                    </td>
                    <td style={S.securityTextCell}>
                      <Text style={S.securityTitle}>Restricted System Access</Text>
                      <Text style={S.securityBody}>
                        This code grants elevated admin privileges.<br />
                        Never share this code with anyone.
                      </Text>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>

            <Text style={S.ignoreText}>
              If you did not initiate this request, audit active admin sessions immediately.
            </Text>

            <Text style={S.signoff}>
              Meetifyy Security Operations<br />
              <strong>Automated Access System</strong>
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

// ── Admin-specific styles ────────────────────────────────────────────────────

const adminBadge = {
  display: 'inline-block',
  backgroundColor: '#1e1b4b',
  color: '#c7d2fe',
  fontSize: '10px',
  fontWeight: '700',
  letterSpacing: '1.5px',
  borderRadius: '100px',
  padding: '5px 14px',
  margin: '0 0 16px',
};

const otpContainer = {
  margin: '0 0 16px',
};

const templateOtpBox = {
  width: '100%',
  border: '1px solid #ddd6fe',
  borderRadius: '14px',
  backgroundColor: '#f5f3ff',
  padding: '18px 0',
  textAlign: 'center' as const,
};

const digitTable = {
  width: '100%',
  borderCollapse: 'separate' as const,
  borderSpacing: '0',
  border: '1px solid #ddd6fe',
  borderRadius: '14px',
  backgroundColor: '#f5f3ff',
  overflow: 'hidden',
};

const digitCell = {
  width: '16.66%',
  height: '68px',
  textAlign: 'center' as const,
  verticalAlign: 'middle' as const,
  borderRight: '1px solid #ddd6fe',
  backgroundColor: '#f5f3ff',
};

const digitChar = {
  fontSize: '30px',
  fontWeight: '700',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  color: '#4338ca',
};

const adminSecurityCard = {
  backgroundColor: '#faf5ff',
  borderRadius: '12px',
  borderLeft: '3px solid #7c3aed',
  padding: '14px 18px',
  margin: '0 0 24px',
  textAlign: 'left' as const,
};

const adminShieldBadge = {
  width: '32px',
  height: '32px',
  borderRadius: '8px',
  backgroundColor: '#ede9fe',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center' as const,
};

export default AdminOtpEmail;
