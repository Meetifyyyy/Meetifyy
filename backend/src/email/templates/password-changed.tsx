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

import { SITE_CONFIG } from '../../config/site.config';
import * as S from './_shared-styles';

interface PasswordChangedEmailProps {
  name?: string;
  time?: string;
  device?: string;
  ip?: string;
  frontendUrl?: string;
  logoIconUrl?: string;
  instagramUrl?: string;
  twitterUrl?: string;
  linkedinUrl?: string;
}

export const PasswordChangedEmail: React.FC<Readonly<PasswordChangedEmailProps>> = ({
  name = 'there',
  time = 'Just now',
  device = 'Unknown device',
  ip = '192.168.1.1',
  frontendUrl = SITE_CONFIG.frontendUrl,
  logoIconUrl = SITE_CONFIG.logoIconUrl,
  instagramUrl = SITE_CONFIG.instagramUrl,
  twitterUrl = SITE_CONFIG.twitterUrl,
  linkedinUrl = SITE_CONFIG.linkedinUrl,
}) => {
  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style>{S.SHARED_HEAD_CSS}</style>
      </Head>
      <Preview>Your Meetifyy password was changed successfully</Preview>
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
              Password <span style={S.highlightText}>successfully changed</span>
            </Heading>

            <Text style={S.greeting}>Hi {name}! 👋</Text>
            <Text style={S.subtext}>
              This confirms your Meetifyy account password was recently updated.
            </Text>

            {/* Update Summary */}
            <Section style={S.detailsBox}>
              <Text style={S.detailsTitle}>Update Summary</Text>
              <table role="presentation" border={0} cellPadding={0} cellSpacing={0} style={{ width: '100%' }}>
                <tbody>
                  <tr>
                    <td style={S.detailLabel}>Time</td>
                    <td style={S.detailValue}>{time}</td>
                  </tr>
                  <tr>
                    <td style={S.detailLabel}>Device</td>
                    <td style={S.detailValue}>{device}</td>
                  </tr>
                  <tr>
                    <td style={S.detailLabel}>IP Address</td>
                    <td style={S.detailValue}>{ip}</td>
                  </tr>
                </tbody>
              </table>
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
                      <Text style={S.securityTitle}>Didn't request this change?</Text>
                      <Text style={S.securityBody}>
                        Your account may be compromised. Reset your password immediately and contact support.
                      </Text>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>

            <Text style={S.ignoreText}>
              If you made this change, you can safely disregard this email.
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

export default PasswordChangedEmail;
