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

import { SITE_CONFIG } from '../../config/site.config';
import * as S from './_shared-styles';

interface ResetPasswordEmailProps {
  name?: string;
  resetLink?: string;
  frontendUrl?: string;
  logoIconUrl?: string;
  instagramUrl?: string;
  twitterUrl?: string;
  linkedinUrl?: string;
}

export const ResetPasswordEmail = ({
  name = 'there',
  resetLink = '',
  frontendUrl = SITE_CONFIG.frontendUrl,
  logoIconUrl = SITE_CONFIG.logoIconUrl,
  instagramUrl = SITE_CONFIG.instagramUrl,
  twitterUrl = SITE_CONFIG.twitterUrl,
  linkedinUrl = SITE_CONFIG.linkedinUrl,
}: ResetPasswordEmailProps) => {
  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style>{S.SHARED_HEAD_CSS}</style>
      </Head>
      <Preview>Reset your Meetifyy password</Preview>
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
              Reset your <span style={S.highlightText}>password</span>
            </Heading>

            <Text style={S.greeting}>Hi {name}! 👋</Text>
            <Text style={S.subtext}>
              We received a request to reset your Meetifyy password.<br />
              Click the button below to set a new one.
            </Text>

            {/* CTA */}
            <Section style={S.btnSection}>
              <Button style={S.button} href={resetLink}>
                Reset My Password
              </Button>
            </Section>

            {/* Expiry */}
            <Section style={S.expirySection}>
              <Text style={S.expiryText}>
                ⏱ This link expires in <span style={S.expiryHighlight}>10 minutes</span>
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
                      <Text style={S.securityTitle}>Keep your account secure</Text>
                      <Text style={S.securityBody}>
                        Never share password reset links with anyone.<br />
                        Meetifyy staff will never ask for your link.
                      </Text>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>

            <Text style={S.ignoreText}>
              If you didn't request this, you can safely ignore this email.
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

export default ResetPasswordEmail;
