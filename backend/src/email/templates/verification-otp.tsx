import * as React from 'react';
import { Heading, Text, Section } from '@react-email/components';
import { BaseLayout } from './components/BaseLayout';
import { OtpDigitBoxes } from './components/OtpDigitBoxes';

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
      <Heading style={heading}>
        Verify your college email
      </Heading>

      <Text style={text}>{greeting}</Text>
      <Text style={text}>
        Welcome to Meetifyy! To complete your signup and access your college community, please verify your college email address.
      </Text>
      <Text style={text}>
        Use the verification code below:
      </Text>

      <Section style={otpCard}>
        <div style={boxesWrapper}>
          <OtpDigitBoxes otp={otp} />
        </div>
        <Text style={otpExpiry}>
          This code will expire in <strong>{expiryTime}</strong>.
        </Text>
      </Section>

      <Text style={text}>
        For your security, please do not share this code with anyone.
      </Text>

      <Text style={text}>
        If you did not create a Meetifyy account, you can safely ignore this email.
      </Text>

      <Text style={noticeText}>
        This is an automated email. Please do not reply directly to this message.
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

const noticeText = {
  fontSize: '13px',
  lineHeight: '20px',
  color: '#64748b',
  marginBottom: '16px',
};

const otpCard = {
  backgroundColor: '#f8faff',
  border: '1px solid #dbeafe',
  borderRadius: '16px',
  padding: '30px 16px 26px',
  textAlign: 'center' as const,
  margin: '24px 0',
  boxShadow: '0 4px 16px -2px rgba(37, 99, 235, 0.06)',
};

const boxesWrapper = {
  margin: '0 auto',
  textAlign: 'center' as const,
};

const otpExpiry = {
  fontSize: '13px',
  color: '#475569',
  margin: '18px 0 0',
};

export default VerificationOtpEmail;
