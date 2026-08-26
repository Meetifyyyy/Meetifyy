import * as React from 'react';
import { Heading, Text, Section } from '@react-email/components';
import { BaseLayout } from './components/BaseLayout';
import { ButtonCTA } from './components/ButtonCTA';
import { SITE_CONFIG } from '../../config/site.config';

interface WelcomeEmailProps {
  name?: string;
  frontendUrl?: string;
}

export const WelcomeEmail = ({
  name = 'there',
  frontendUrl = SITE_CONFIG.frontendUrl,
}: WelcomeEmailProps) => {
  return (
    <BaseLayout previewText="Welcome to Meetifyy, your adventure starts here!">
      <Heading style={heading}>
        Welcome to Meetifyy!
      </Heading>

      <Text style={text}>Hi {name}!</Text>
      <Text style={text}>
        We are thrilled to have you join our community. Meetifyy helps you discover activities, join groups, and build real connections with people around you.
      </Text>

      <Section style={stepsBox}>
        <div style={stepsHeader}>
          <Text style={stepsTitle}>What you can do next</Text>
        </div>
        <table role="presentation" border={0} cellPadding={0} cellSpacing={0} style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr style={rowBorder}>
              <td style={stepBullet}>✨</td>
              <td style={stepText}>Complete your profile setup and add your interests</td>
            </tr>
            <tr style={rowBorder}>
              <td style={stepBullet}>📍</td>
              <td style={stepText}>Explore activities happening near your campus</td>
            </tr>
            <tr style={rowBorder}>
              <td style={stepBullet}>👥</td>
              <td style={stepText}>Join communities matching your passions</td>
            </tr>
            <tr>
              <td style={stepBulletLast}>🤝</td>
              <td style={stepTextLast}>Connect with classmates and make lasting friendships</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <ButtonCTA href={`${frontendUrl}/home`}>
        Explore Meetifyy
      </ButtonCTA>

      <Text style={text}>
        Thanks,<br />
        <strong>The Meetifyy Team</strong>
      </Text>
    </BaseLayout>
  );
};

const heading = {
  fontSize: '22px',
  fontWeight: 'bold',
  color: '#0f172a',
  marginBottom: '20px',
  textAlign: 'center' as const,
};

const text = {
  fontSize: '15px',
  lineHeight: '24px',
  color: '#334155',
  marginBottom: '16px',
};

const stepsBox = {
  backgroundColor: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  overflow: 'hidden',
  margin: '24px 0',
};

const stepsHeader = {
  backgroundColor: '#f1f5f9',
  padding: '10px 18px',
  borderBottom: '1px solid #e2e8f0',
};

const stepsTitle = {
  fontSize: '11px',
  fontWeight: '700',
  color: '#475569',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.08em',
  margin: 0,
};

const rowBorder = {
  borderBottom: '1px solid #f1f5f9',
};

const stepBullet = {
  width: '32px',
  padding: '10px 0 10px 18px',
  fontSize: '15px',
  verticalAlign: 'middle' as const,
};

const stepText = {
  color: '#334155',
  fontSize: '13.5px',
  lineHeight: '20px',
  fontWeight: '500',
  padding: '10px 18px 10px 10px',
  verticalAlign: 'middle' as const,
};

const stepBulletLast = {
  ...stepBullet,
  padding: '10px 0 12px 18px',
};

const stepTextLast = {
  ...stepText,
  padding: '10px 18px 12px 10px',
};

export default WelcomeEmail;
