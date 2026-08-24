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

interface WelcomeEmailProps {
  name?: string;
  frontendUrl?: string;
  logoIconUrl?: string;
  instagramUrl?: string;
  twitterUrl?: string;
  linkedinUrl?: string;
}

export const WelcomeEmail = ({
  name = 'there',
  frontendUrl = SITE_CONFIG.frontendUrl,
  logoIconUrl = SITE_CONFIG.logoIconUrl,
  instagramUrl = SITE_CONFIG.instagramUrl,
  twitterUrl = SITE_CONFIG.twitterUrl,
  linkedinUrl = SITE_CONFIG.linkedinUrl,
}: WelcomeEmailProps) => {
  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style>{S.SHARED_HEAD_CSS}</style>
      </Head>
      <Preview>Welcome to Meetifyy — your adventure starts here 👋</Preview>
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
              Welcome to <span style={S.highlightText}>Meetifyy</span> 👋
            </Heading>

            <Text style={S.greeting}>Hi {name}!</Text>
            <Text style={S.subtext}>
              We're thrilled to have you join our community.<br />
              Meetifyy helps you discover activities and build real, lasting connections.
            </Text>

            {/* Next Steps Box */}
            <Section style={S.stepsBox}>
              <Text style={S.stepsTitle}>What you can do next</Text>
              <Text style={S.stepItem}>🙂 Complete your profile setup</Text>
              <Text style={S.stepItem}>🔍 Explore activities near your location</Text>
              <Text style={S.stepItem}>👥 Join groups matching your interests</Text>
              <Text style={{ ...S.stepItem, margin: '0' }}>🤝 Connect and make lasting friendships</Text>
            </Section>

            {/* CTA */}
            <Section style={S.btnSection}>
              <Button style={S.button} href={`${frontendUrl}/home`}>
                Explore Meetifyy →
              </Button>
            </Section>

            {/* Safety card */}
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
                      <Text style={S.securityTitle}>Safe Community</Text>
                      <Text style={S.securityBody}>
                        We prioritize safety across all Meetifyy events.<br />
                        Always follow our community guidelines.
                      </Text>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>

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

export default WelcomeEmail;
