import * as React from 'react';
import { BaseLayout } from './components/BaseLayout';
import { cls, color } from './components/tokens';
import { Headline, Notice, Paragraph, Signoff } from './components/Blocks';
import { OtpCode } from './components/OtpCode';

interface EmailAddressOtpEmailProps {
  name?: string;
  otp?: string;
  expiryTime?: string;
  /** Which address is being confirmed. */
  kind?: 'college' | 'personal';
  /** College name, for the `college` kind. */
  collegeName?: string;
}

/**
 * Confirms control of an address being ADDED to an existing account: a
 * college email on the Campus page, or a new personal sign-in email.
 *
 * Sent only to the address being confirmed. Carries no account detail beyond
 * the greeting name, because the mailbox may not belong to the account holder
 * — which is exactly the case the "didn't request this" line is for.
 */
export const EmailAddressOtpEmail = ({
  name = 'there',
  otp = '000000',
  expiryTime = '10 minutes',
  kind = 'college',
  collegeName,
}: EmailAddressOtpEmailProps) => {
  const greeting = name?.trim() ? `Hi ${name.trim()},` : 'Hi there,';
  const isCollege = kind === 'college';
  const title = isCollege
    ? 'Verify your college email'
    : 'Confirm your new email';

  return (
    <BaseLayout previewText={title}>
      <Headline eyebrow="Verification code" title={title}>
        {isCollege ? (
          <>
            {greeting} enter the code below on the Campus page to link this
            address{collegeName ? ` to ${collegeName}` : ''} and unlock your
            campus on Meetifyy.
          </>
        ) : (
          <>
            {greeting} enter the code below to make this address the email you
            sign in to Meetifyy with.
          </>
        )}
      </Headline>

      <OtpCode
        otp={otp}
        footnote={
          <>
            This code will expire in{' '}
            <strong className={cls.ink} style={{ color: color.ink }}>
              {expiryTime}
            </strong>
            .
          </>
        }
      />

      <Paragraph>
        For your security, please do not share this code with anyone.
      </Paragraph>
      <Paragraph>
        If you did not ask for this, you can safely ignore this email. Nothing
        changes unless the code is entered.
      </Paragraph>

      <Notice>
        This is an automated email. Please do not reply directly to this
        message.
      </Notice>

      <Signoff />
    </BaseLayout>
  );
};

export default EmailAddressOtpEmail;
