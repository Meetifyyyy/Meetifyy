import * as React from 'react';
import { Heading, Text, Section } from '@react-email/components';
import { BaseLayout } from './components/BaseLayout';

interface VerificationOtpEmailProps {
  name?: string;
  otp?: string;
}

export const VerificationOtpEmail = ({
  name = 'there',
  otp = '000000',
}: VerificationOtpEmailProps) => {
  return (
    <BaseLayout previewText="Your Meetifyy verification code">
      <Heading style={heading}>
        Verify your email
      </Heading>

      <Text style={text}>Hi {name},</Text>
      <Text style={text}>
        Use the following verification code to complete your signup or login process:
      </Text>

      <Section style={otpContainer}>
        <Text style={otpText}>{otp}</Text>
      </Section>

      <Text style={text}>
        This code will expire in 10 minutes. If you didn't request this code, you can safely ignore this email.
      </Text>

      <Text style={text}>
        Thanks,<br />
        <strong>The Meetifyy Team</strong>
      </Text>
    </BaseLayout>
  );
};

const heading = {
  fontSize: '24px',
  fontWeight: 'bold',
  color: '#050F24',
  marginBottom: '20px',
  textAlign: 'center' as const,
};

const text = {
  fontSize: '16px',
  lineHeight: '24px',
  color: '#050F24',
  marginBottom: '16px',
};

const otpContainer = {
  backgroundColor: '#f6f9fc',
  padding: '24px',
  borderRadius: '8px',
  textAlign: 'center' as const,
  margin: '30px 0',
};

const otpText = {
  fontSize: '32px',
  fontWeight: 'bold',
  letterSpacing: '8px',
  color: '#050F24',
  margin: '0',
};

export default VerificationOtpEmail;
