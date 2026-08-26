import * as React from 'react';
import { Heading, Text } from '@react-email/components';
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
    <BaseLayout previewText="Welcome to Meetifyy — your adventure starts here 👋">
      <Heading style={heading}>
        Welcome to Meetifyy 👋
      </Heading>

      <Text style={text}>Hi {name}!</Text>
      <Text style={text}>
        We're thrilled to have you join our community. Meetifyy helps you discover activities and build real, lasting connections.
      </Text>

      <Text style={text}>
        <strong>What you can do next:</strong>
        <br />
        • Complete your profile setup
        <br />
        • Explore activities near your location
        <br />
        • Join groups matching your interests
        <br />
        • Connect and make lasting friendships
      </Text>

      <ButtonCTA href={`${frontendUrl}/home`}>
        Explore Meetifyy →
      </ButtonCTA>

      <Text style={text}>
        Thanks,<br />
        <strong>The Meetifyy Team</strong>
      </Text>
    </BaseLayout>
  );
};

const heading = {
  fontSize: '24px',
  fontWeight: 'bold',
  color: '#050F24',
  marginBottom: '20px',
  textAlign: 'center' as const,
};

const text = {
  fontSize: '16px',
  lineHeight: '24px',
  color: '#050F24',
  marginBottom: '16px',
};

export default WelcomeEmail;
