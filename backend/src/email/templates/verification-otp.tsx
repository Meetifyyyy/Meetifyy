import * as React from 'react';
import { BaseLayout } from './components/BaseLayout';
import { Headline, Notice, Paragraph, Signoff } from './components/Blocks';
import { OtpCode } from './components/OtpCode';

interface VerificationOtpEmailProps {
  name?: string;
  otp?: string;
  expiryTime?: string;
}

export const VerificationOtpEmail = ({
  name = 'there',
  otp = '000000',
  expiryTime = '10 minutes',
}: VerificationOtpEmailProps) => {
  const greeting = name?.trim() ? `Hi ${name.trim()},` : 'Hi there,';

  return (
    <BaseLayout previewText="Verify your college email address">
      <Headline eyebrow="Almost there" title="Verify your college email">
        {greeting} welcome to Meetifyy! To complete your signup and access your
        college community, please verify your college email address.
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

      <Paragraph>
        For your security, please do not share this code with anyone.
      </Paragraph>
      <Paragraph>
        If you did not create a Meetifyy account, you can safely ignore this
        email.
      </Paragraph>

      <Notice>
        This is an automated email. Please do not reply directly to this
        message.
      </Notice>

      <Signoff />
    </BaseLayout>
  );
};

export default VerificationOtpEmail;
