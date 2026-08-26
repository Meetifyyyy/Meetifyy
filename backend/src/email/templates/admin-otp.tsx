import * as React from 'react';
import { Heading, Text, Section } from '@react-email/components';
import { BaseLayout } from './components/BaseLayout';
import { OtpDigitBoxes } from './components/OtpDigitBoxes';

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
        A login attempt was made to the Super Admin panel. Use the following code to access the system:
      </Text>

      <Section style={otpCard}>
        <div style={boxesWrapper}>
          <OtpDigitBoxes otp={otp} />
        </div>
        <Text style={otpExpiry}>This code will expire in 10 minutes.</Text>
      </Section>

      <Section style={securityNoticeBox}>
        <Text style={securityNoticeTitle}>Security Notice</Text>
        <Text style={securityNoticeText}>
          This code is highly sensitive. Do not share this code with anyone. If you did not initiate this login, your credentials may be compromised. Please investigate immediately.
        </Text>
      </Section>

      <Text style={text}>
        Thanks,<br />
        <strong>Meetifyy Security System</strong>
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

const otpCard = {
  backgroundColor: '#f8faff',
  border: '1px solid #dbeafe',
  borderRadius: '16px',
  padding: '30px 16px 26px',
  textAlign: 'center' as const,
  margin: '28px 0',
  boxShadow: '0 4px 16px -2px rgba(37, 99, 235, 0.06)',
};

const boxesWrapper = {
  margin: '0 auto',
  textAlign: 'center' as const,
};

const otpExpiry = {
  fontSize: '12.5px',
  color: '#64748b',
  fontWeight: '500',
  margin: '18px 0 0',
};

const securityNoticeBox = {
  backgroundColor: '#eff6ff',
  border: '1px solid #dbeafe',
  borderLeft: '4px solid #2563eb',
  borderRadius: '10px',
  padding: '14px 18px',
  margin: '24px 0',
};

const securityNoticeTitle = {
  fontSize: '13.5px',
  fontWeight: '700',
  color: '#1e40af',
  margin: '0 0 4px',
};

const securityNoticeText = {
  fontSize: '13px',
  lineHeight: '19px',
  color: '#1e3a8a',
  margin: 0,
};

export default AdminOtpEmail;
