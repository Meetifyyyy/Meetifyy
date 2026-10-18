import * as React from 'react';
import { BaseLayout } from './components/BaseLayout';
import { Callout, Headline, Signoff } from './components/Blocks';
import { SITE_CONFIG } from '../../config/site.config';
import { cls, color } from './components/tokens';

interface SignInEmailChangedEmailProps {
  name?: string;
  /** The new address, MASKED. Never the full address in a mailbox that may no longer be the owner's. */
  newEmailMasked?: string;
}

/**
 * Sent to the PREVIOUS sign-in address after it was replaced through the
 * OTP-verified personal-email flow, so an owner who did not make the change
 * learns about it in the inbox they still control. Same shape as the
 * password-changed notice.
 */
export const SignInEmailChangedEmail = ({
  name = 'there',
  newEmailMasked = 'a new address',
}: SignInEmailChangedEmailProps) => {
  const supportLink =
    SITE_CONFIG.supportUrl || `${SITE_CONFIG.frontendUrl}/help-and-support`;

  return (
    <BaseLayout previewText="Your Meetifyy sign-in email was changed">
      <Headline eyebrow="Security notice" title="Sign-in email changed">
        Hi {name}, the email you use to sign in to Meetifyy was changed to{' '}
        <strong className={cls.ink} style={{ color: color.ink }}>
          {newEmailMasked}
        </strong>
        . From now on, sign in with that address.
      </Headline>

      <Callout tone="warn" title="Wasn't you?">
        Contact our{' '}
        <a className={cls.ink} href={supportLink} style={supportAnchor}>
          support team
        </a>{' '}
        straight away so we can secure your account.
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

export default SignInEmailChangedEmail;
