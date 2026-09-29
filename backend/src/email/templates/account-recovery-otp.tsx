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

interface AccountRecoveryOtpEmailProps {
  name?: string;
  otp?: string;
  expiryTime?: string;
  /** Server-formatted deletion date, e.g. "12 October 2026". Never computed here. */
  scheduledDeletionDate?: string;
}

/**
 * Confirms a request to RECOVER an account inside its deletion window.
 *
 * A genuinely different email from the deletion one, not a re-skin: the action
 * is the opposite, the stakes are the opposite, and the warning has to say the
 * opposite thing. Someone who did not request this is being told that a
 * deletion they DID want is at risk of being cancelled — which is the reverse
 * of the deletion email's warning, and the reason a shared template with
 * swapped strings would eventually mislead somebody.
 *
 * It also carries the scheduled deletion date, because the useful question at
 * this moment is "how long do I still have", and the date is the server's
 * answer.
 */
export const AccountRecoveryOtpEmail = ({
  name = 'there',
  otp = '000000',
  expiryTime = '10 minutes',
  scheduledDeletionDate,
}: AccountRecoveryOtpEmailProps) => {
  const greeting = name?.trim() ? `Hi ${name.trim()},` : 'Hi there,';

  return (
    <BaseLayout previewText="Confirm you want to recover your account">
      <Headline eyebrow="Welcome back?" title="Recover your account">
        {greeting} we received a request to cancel the scheduled deletion of
        your Meetifyy account and restore it. To confirm it was you, enter the
        verification code below.
      </Headline>

      <OtpCode
        otp={otp}
        footnote={
          <>
            This code will expire in{' '}
            <strong style={{ color: '#0A0F1D' }}>{expiryTime}</strong>.
          </>
        }
      />

      {scheduledDeletionDate ? (
        <Callout
          tone="info"
          title="Your account is still scheduled for deletion"
        >
          Unless you complete this step, it will be permanently deleted on{' '}
          <strong>{scheduledDeletionDate}</strong>.
        </Callout>
      ) : null}

      <Callout tone="warn" title="Didn't request this?">
        Someone may be trying to stop your account from being deleted. Do not
        enter this code. If you ignore this email, your account will be deleted
        as scheduled. If you are concerned, change your password and contact us.
      </Callout>

      <Paragraph>
        Once confirmed, the scheduled deletion is cancelled and your account,
        profile and content become visible again straight away.
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

export default AccountRecoveryOtpEmail;
