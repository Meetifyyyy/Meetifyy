import * as React from 'react';
import { BaseLayout } from './components/BaseLayout';
import { Callout, DetailList, Headline, Signoff } from './components/Blocks';
import { SITE_CONFIG } from '../../config/site.config';
import { color } from './components/tokens';

interface PasswordChangedEmailProps {
  name?: string;
  time?: string;
  device?: string;
  ip?: string;
}

export const PasswordChangedEmail = ({
  name = 'there',
  time = 'Just now',
  device = 'Unknown Device',
  ip = 'Unknown IP',
}: PasswordChangedEmailProps) => {
  const supportLink =
    SITE_CONFIG.supportUrl || `${SITE_CONFIG.frontendUrl}/help-and-support`;

  return (
    <BaseLayout previewText="Your Meetifyy password has been changed">
      <Headline eyebrow="Confirmation" title="Password changed">
        Hi {name}, this is a confirmation that the password for your Meetifyy
        account was successfully changed.
      </Headline>

      <DetailList
        title="Change details"
        rows={[
          { label: 'Time', value: time },
          { label: 'Device', value: device },
          { label: 'IP address', value: ip },
        ]}
      />

      <Callout tone="warn" title="Did not make this change?">
        Please reset your password immediately or contact our{' '}
        <a href={supportLink} style={supportAnchor}>
          support team
        </a>{' '}
        to secure your account.
      </Callout>

      <Signoff />
    </BaseLayout>
  );
};

const supportAnchor = {
  color: color.ink,
  textDecoration: 'underline',
  fontWeight: 600,
};

export default PasswordChangedEmail;
