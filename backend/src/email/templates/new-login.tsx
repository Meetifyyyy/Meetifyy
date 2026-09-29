import * as React from 'react';
import { BaseLayout } from './components/BaseLayout';
import {
  Callout,
  DetailList,
  Headline,
  Paragraph,
  Signoff,
} from './components/Blocks';
import { SITE_CONFIG } from '../../config/site.config';
import { color } from './components/tokens';

interface NewLoginEmailProps {
  name?: string;
  device?: string;
  location?: string;
  time?: string;
  browser?: string;
  os?: string;
  ip?: string;
}

export const NewLoginEmail = ({
  name = 'there',
  device = 'MacBook Pro',
  location = 'Unknown Location',
  time = 'Just now',
  browser = 'Chrome 126',
  os = 'macOS Sonoma',
  ip = '192.168.1.1',
}: NewLoginEmailProps) => {
  const supportLink =
    SITE_CONFIG.supportUrl || `${SITE_CONFIG.frontendUrl}/help-and-support`;

  return (
    <BaseLayout previewText="New login to your Meetifyy account detected">
      <Headline eyebrow="Sign-in alert" title="New login detected">
        Hi {name}, your Meetifyy account was accessed from a new device. Review
        the session details below.
      </Headline>

      <DetailList
        title="Session details"
        rows={[
          { label: 'Time', value: time },
          { label: 'Device', value: device },
          { label: 'Browser', value: `${browser} (${os})` },
          { label: 'IP address', value: ip || location },
        ]}
      />

      <Callout tone="warn" title="Do not recognize this activity?">
        Change your password immediately to protect your account. Reach out to{' '}
        <a href={supportLink} style={supportAnchor}>
          support
        </a>{' '}
        if you need assistance.
      </Callout>

      <Paragraph>If this was you, no further action is required.</Paragraph>

      <Signoff />
    </BaseLayout>
  );
};

const supportAnchor = {
  color: color.ink,
  textDecoration: 'underline',
  fontWeight: 600,
};

export default NewLoginEmail;
