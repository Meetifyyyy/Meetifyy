import * as React from 'react';
import { BaseLayout } from './components/BaseLayout';
import {
  Callout,
  Headline,
  Notice,
  Paragraph,
  Signoff,
} from './components/Blocks';
import { OtpCode } from './components/OtpCode';

interface AccountDeletionOtpEmailProps {
  name?: string;
  otp?: string;
  expiryTime?: string;
}

/**
 * Confirms a request to DELETE an account.
 *
 * Written to be unmistakable at a glance: someone who did not ask for this must
 * be able to tell within a second of opening it that their account is about to
 * be scheduled for deletion, and what to do. Hence the warning panel above the
 * code rather than the usual small print underneath it — a person who did not
 * request this should reach the "secure your account" instruction before they
 * reach the digits.
 *
 * Carries no account detail beyond the greeting name: the mailbox is already
 * known to whoever is reading, and anything more would leak profile data into
 * an inbox that may not be the owner's.
 */
export const AccountDeletionOtpEmail = ({
  name = 'there',
  otp = '000000',
  expiryTime = '10 minutes',
}: AccountDeletionOtpEmailProps) => {
  const greeting = name?.trim() ? `Hi ${name.trim()},` : 'Hi there,';

  return (
    <BaseLayout previewText="Confirm your account deletion request">
      <Headline eyebrow="Action required" title="Confirm account deletion">
        {greeting} we received a request to delete your Meetifyy account. To
        continue, enter the verification code below.
      </Headline>

      <Callout tone="danger" title="Didn't request this?">
        Someone may have access to your account. Do not enter this code. Change
        your password straight away and contact us if anything looks wrong.
      </Callout>

      <OtpCode
        otp={otp}
        footnote={
          <>
            This code will expire in{' '}
            <strong style={{ color: '#0A0F1D' }}>{expiryTime}</strong>.
          </>
        }
      />

      <Paragraph>
        Once confirmed, your account is scheduled for deletion and hidden from
        everyone else. You have <strong>30 days</strong> to change your mind,
        during which you can sign back in to recover it. After 30 days the
        deletion is permanent and cannot be undone.
      </Paragraph>
      <Paragraph>
        For your security, never share this code with anyone.
      </Paragraph>

      <Notice>
        This is an automated email. Please do not reply directly to this
        message.
      </Notice>

      <Signoff />
    </BaseLayout>
  );
};

export default AccountDeletionOtpEmail;
