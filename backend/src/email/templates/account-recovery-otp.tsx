import * as React from 'react';
import { Heading, Text, Section } from '@react-email/components';
import { BaseLayout } from './components/BaseLayout';
import { OtpDigitBoxes } from './components/OtpDigitBoxes';

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
      <Heading style={heading}>Recover your account</Heading>

      <Text style={text}>{greeting}</Text>
      <Text style={text}>
        We received a request to cancel the scheduled deletion of your Meetifyy
        account and restore it. To confirm it was you, enter the verification
        code below.
      </Text>

      <Section style={otpCard}>
        <div style={boxesWrapper}>
          <OtpDigitBoxes otp={otp} />
        </div>
        <Text style={otpExpiry}>
          This code will expire in <strong>{expiryTime}</strong>.
        </Text>
      </Section>

      {scheduledDeletionDate ? (
        <Section style={infoCard}>
          <Text style={infoTitle}>
            Your account is still scheduled for deletion
          </Text>
          <Text style={infoText}>
            Unless you complete this step, it will be permanently deleted on{' '}
            <strong>{scheduledDeletionDate}</strong>.
          </Text>
        </Section>
      ) : null}

      <Section style={warningCard}>
        <Text style={warningTitle}>Didn&apos;t request this?</Text>
        <Text style={warningText}>
          Someone may be trying to stop your account from being deleted. Do not
          enter this code. If you ignore this email, your account will be deleted
          as scheduled. If you are concerned, change your password and contact
          us.
        </Text>
      </Section>

      <Text style={text}>
        Once confirmed, the scheduled deletion is cancelled and your account,
        profile and content become visible again straight away.
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

const infoCard = {
  backgroundColor: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  padding: '16px 18px',
  margin: '24px 0',
};

const infoTitle = {
  fontSize: '14px',
  fontWeight: 'bold' as const,
  color: '#0f172a',
  margin: '0 0 6px',
};

const infoText = {
  fontSize: '14px',
  lineHeight: '22px',
  color: '#475569',
  margin: 0,
};

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

export default AccountRecoveryOtpEmail;
