import * as React from 'react';
import { BaseLayout } from './components/BaseLayout';
import { Callout, Headline, Signoff } from './components/Blocks';
import { OtpCode } from './components/OtpCode';

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
      <Headline eyebrow="Super Admin" title="Admin access code">
        Hi {name}, a login attempt was made to the Super Admin panel. Use the
        following code to access the system.
      </Headline>

      <OtpCode otp={otp} footnote="This code will expire in 10 minutes." />

      <Callout tone="danger" title="Security notice">
        This code is highly sensitive. Do not share this code with anyone. If
        you did not initiate this login, your credentials may be compromised.
        Please investigate immediately.
      </Callout>

      <Signoff team="Meetifyy Security System" />
    </BaseLayout>
  );
};

export default AdminOtpEmail;
