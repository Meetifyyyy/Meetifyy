import { render } from '@react-email/render';
import { createElement } from 'react';
import * as nodemailer from 'nodemailer';

import { WelcomeEmail } from './src/email/templates/welcome';
import { VerificationOtpEmail } from './src/email/templates/verification-otp';
import { AdminOtpEmail } from './src/email/templates/admin-otp';
import { ResetPasswordEmail } from './src/email/templates/reset-password';
import { NewLoginEmail } from './src/email/templates/new-login';
import { PasswordChangedEmail } from './src/email/templates/password-changed';
import { SupportRequestReceivedEmail } from './src/email/templates/support-request-received';
import { SupportReplyEmail } from './src/email/templates/support-reply';

async function sendAll() {
  const transporter = nodemailer.createTransport({
    host: '127.0.0.1',
    port: 1025,
    secure: false,
    ignoreTLS: true,
  });

  const targetEmail = 'sarthaksaini7770@gmail.com';
  const from = 'Meetifyy <noreply@meetifyy.app>';

  const emails = [
    {
      subject: 'New login detected on your Meetifyy account',
      component: createElement(NewLoginEmail, {
        name: 'Sarthak Saini',
        device: 'Desktop / Laptop',
        location: 'Bengaluru, India',
        time: 'Wed, Aug 26, 2026, 08:55:56 PM',
        browser: 'Chrome 151',
        os: 'Linux',
        ip: '127.0.0.1',
      }),
    },
    {
      subject: 'Your Meetifyy password has been changed',
      component: createElement(PasswordChangedEmail, {
        name: 'Sarthak Saini',
        time: 'Wed, Aug 26, 2026, 09:01:15 PM',
        device: 'Chrome 151 on Linux',
        ip: '127.0.0.1',
      }),
    },
    {
      subject: 'Verify your college email (Meetifyy)',
      component: createElement(VerificationOtpEmail, {
        name: 'Sarthak Saini',
        otp: '483920',
      }),
    },
    {
      subject: 'Super Admin Login Attempt: Meetifyy Security',
      component: createElement(AdminOtpEmail, {
        name: 'Sarthak Saini',
        otp: '739201',
      }),
    },
    {
      subject: 'Reset your Meetifyy password',
      component: createElement(ResetPasswordEmail, {
        name: 'Sarthak Saini',
        resetLink: 'https://dev.meetifyy.app/reset-password?token=sample-token-123',
      }),
    },
    {
      subject: 'Welcome to Meetifyy: your adventure starts here!',
      component: createElement(WelcomeEmail, {
        name: 'Sarthak Saini',
        frontendUrl: 'https://dev.meetifyy.app',
      }),
    },
    {
      subject: 'Support request received: #REQ-984210 | Meetifyy',
      component: createElement(SupportRequestReceivedEmail, {
        name: 'Sarthak Saini',
        email: 'sarthaksaini7770@gmail.com',
        ticketNumber: 'REQ-984210',
        categoryLabel: 'Account & Login',
        subject: "Can't log in with institutional email",
        description:
          "I tried logging in using my university email address, but I'm not receiving the 6-digit verification code. I checked my spam folder as well.",
        attachments: [
          {
            filename: 'error-screenshot.png',
            url: 'https://dev.meetifyy.app/api/media/support/sample-error-screenshot.png',
            size: 245760,
          },
          {
            filename: 'student-id.pdf',
            url: 'https://dev.meetifyy.app/api/media/support/sample-student-id.pdf',
            size: 1048576,
          },
        ],
        helpCentreUrl: 'https://dev.meetifyy.app/help-and-support',
      }),
    },
    {
      subject: 'Update on your support request #REQ-984210 | Meetifyy',
      component: createElement(SupportReplyEmail, {
        ticketNumber: 'REQ-984210',
        replyHtml:
          '<p>Hi Sarthak,</p><p>We looked into your account and noticed that your university domain had a temporary mail delivery throttle. We have updated your verification settings and dispatched a new code.</p><p>Please try signing in again now. If you have any further questions, feel free to visit our Help and Support page.</p><p>Best regards,<br />Meetifyy Support Team</p>',
        helpCentreUrl: 'https://dev.meetifyy.app/help-and-support',
      }),
    },
  ];

  console.log(`Sending ${emails.length} email templates to Mailpit (127.0.0.1:1025)...`);

  for (const item of emails) {
    const html = await render(item.component);
    const info = await transporter.sendMail({
      from,
      to: targetEmail,
      subject: item.subject,
      html,
    });
    console.log(`✓ Sent: "${item.subject}" (ID: ${info.messageId})`);
  }

  console.log('\n🎉 All email templates sent successfully to Mailpit!');
}

sendAll().catch((err) => {
  console.error('Error sending emails to Mailpit:', err);
  process.exit(1);
});
