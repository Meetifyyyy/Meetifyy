import * as React from 'react';
import { Heading, Text, Section } from '@react-email/components';
import { BaseLayout } from './components/BaseLayout';

interface AdminOtpEmailProps {
  name?: string;
  otp?: string;
}

export const AdminOtpEmail = ({
  name = 'Admin',
  otp = '000000',
}: AdminOtpEmailProps) => {
  return (
    <BaseLayout previewText="Super Admin Login Attempt">
      <Heading style={heading}>
        Admin Access Code
      </Heading>

      <Text style={text}>Hi {name},</Text>
      <Text style={text}>
        A login attempt was made to the Super Admin panel. Use the following code to securely access the system:
      </Text>

      <Section style={otpContainer}>
        <Text style={otpText}>{otp}</Text>
      </Section>

      <Text style={text}>
        This code is highly sensitive and will expire in 10 minutes. <strong>Do not share this code with anyone.</strong>
      </Text>

      <Text style={text}>
        If you did not initiate this login, your credentials may be compromised. Please investigate immediately.
      </Text>

      <Text style={text}>
        Thanks,<br />
        <strong>Meetifyy Security System</strong>
      </Text>
    </BaseLayout>
  );
};

const heading = {
  fontSize: '24px',
  fontWeight: 'bold',
  color: '#D32F2F', // Red for admin alerts
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
  border: '1px solid #ffcdd2',
};

const otpText = {
  fontSize: '32px',
  fontWeight: 'bold',
  letterSpacing: '8px',
  color: '#D32F2F',
  margin: '0',
};

export default AdminOtpEmail;
