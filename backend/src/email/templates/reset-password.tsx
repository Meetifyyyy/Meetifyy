import * as React from 'react';
import { BaseLayout } from './components/BaseLayout';
import { ButtonCTA } from './components/ButtonCTA';
import { Headline, Paragraph, Signoff } from './components/Blocks';

interface ResetPasswordEmailProps {
  name?: string;
  resetLink?: string;
}

export const ResetPasswordEmail = ({
  name = 'there',
  resetLink = '#',
}: ResetPasswordEmailProps) => {
  return (
    <BaseLayout previewText="Reset your Meetifyy password">
      <Headline eyebrow="Password reset" title="Reset your password">
        Hi {name}, we received a request to reset the password for your Meetifyy
        account. Use the button below to choose a new password.
      </Headline>

      <ButtonCTA href={resetLink}>Reset Password</ButtonCTA>

      <Paragraph>
        This password reset link is valid for 10 minutes. If you did not request
        a password reset, you can safely ignore this email. Your password will
        remain secure and unchanged.
      </Paragraph>

      <Signoff />
    </BaseLayout>
  );
};

export default ResetPasswordEmail;
