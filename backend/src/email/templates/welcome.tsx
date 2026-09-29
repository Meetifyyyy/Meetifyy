import * as React from 'react';
import { BaseLayout } from './components/BaseLayout';
import { ButtonCTA } from './components/ButtonCTA';
import { Headline, Signoff, Steps } from './components/Blocks';
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
      <Headline eyebrow={`Hi ${name}`} title="Welcome to Meetifyy">
        We are thrilled to have you join our community. Meetifyy helps you
        discover activities, join groups, and build real connections with people
        around you.
      </Headline>

      <Steps
        title="What you can do next"
        items={[
          'Complete your profile setup and add your interests',
          'Explore activities happening near your campus',
          'Join communities matching your passions',
          'Connect with classmates and make lasting friendships',
        ]}
      />

      <ButtonCTA href={`${frontendUrl}/home`}>Explore Meetifyy</ButtonCTA>

      <Signoff />
    </BaseLayout>
  );
};

export default WelcomeEmail;
