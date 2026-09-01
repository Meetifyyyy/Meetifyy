import * as React from 'react';
import { Heading, Text, Section } from '@react-email/components';
import { BaseLayout } from './components/BaseLayout';
import { OtpDigitBoxes } from './components/OtpDigitBoxes';

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
      <Heading style={heading}>Confirm account deletion</Heading>

      <Text style={text}>{greeting}</Text>
      <Text style={text}>
        We received a request to delete your Meetifyy account. To continue,
        enter the verification code below.
      </Text>

      <Section style={otpCard}>
        <div style={boxesWrapper}>
          <OtpDigitBoxes otp={otp} />
        </div>
        <Text style={otpExpiry}>
          This code will expire in <strong>{expiryTime}</strong>.
        </Text>
      </Section>

      <Section style={warningCard}>
        <Text style={warningTitle}>Didn&apos;t request this?</Text>
        <Text style={warningText}>
          Someone may have access to your account. Do not enter this code.
          Change your password straight away and contact us if anything looks
          wrong.
        </Text>
      </Section>

      <Text style={text}>
        Once confirmed, your account is scheduled for deletion and hidden from
        everyone else. You have <strong>30 days</strong> to change your mind —
        sign back in during that time and you can recover it. After 30 days the
        deletion is permanent and cannot be undone.
      </Text>

      <Text style={text}>
        For your security, never share this code with anyone.
      </Text>

      <Text style={noticeText}>
        This is an automated email. Please do not reply directly to this
        message.
      </Text>

      <Text style={text}>
        Thanks,
        <br />
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

/**
 * Amber rather than red. Red reads as "this already went wrong"; the accurate
 * message is "check this was you before it does".
 */
const warningCard = {
  backgroundColor: '#fffbeb',
  border: '1px solid #fde68a',
  borderRadius: '12px',
  padding: '16px 18px',
  margin: '24px 0',
};

const warningTitle = {
  fontSize: '14px',
  fontWeight: 'bold' as const,
  color: '#92400e',
  margin: '0 0 6px',
};

const warningText = {
  fontSize: '14px',
  lineHeight: '22px',
  color: '#78350f',
  margin: 0,
};

export default AccountDeletionOtpEmail;
