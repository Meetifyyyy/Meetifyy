import * as React from 'react';
import { Heading, Text } from '@react-email/components';
import { BaseLayout } from './components/BaseLayout';
import { ButtonCTA } from './components/ButtonCTA';

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
      <Heading style={heading}>
        Reset your password
      </Heading>

      <Text style={text}>Hi {name},</Text>
      <Text style={text}>
        We received a request to reset the password for your Meetifyy account. Click the button below to choose a new password:
      </Text>

      <ButtonCTA href={resetLink}>
        Reset Password
      </ButtonCTA>

      <Text style={text}>
        This password reset link is valid for 10 minutes. If you did not request a password reset, you can safely ignore this email. Your password will remain secure and unchanged.
      </Text>

      <Text style={text}>
        Thanks,<br />
        <strong>The Meetifyy Team</strong>
      </Text>
    </BaseLayout>
  );
};

const heading = {
  fontSize: '22px',
  fontWeight: 'bold',
  color: '#0f172a',
  marginBottom: '20px',
  textAlign: 'center' as const,
};

const text = {
  fontSize: '15px',
  lineHeight: '24px',
  color: '#334155',
  marginBottom: '16px',
};

export default ResetPasswordEmail;
