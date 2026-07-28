import * as nodemailer from 'nodemailer';
import { render } from '@react-email/render';
import { createElement } from 'react';

import { WelcomeEmail } from '../src/email/templates/welcome';
import { NewLoginEmail } from '../src/email/templates/new-login';
import { ResetPasswordEmail } from '../src/email/templates/reset-password';
import { VerificationOtpEmail } from '../src/email/templates/verification-otp';
import { AdminOtpEmail } from '../src/email/templates/admin-otp';
import { PasswordChangedEmail } from '../src/email/templates/password-changed';

async function sendAllTestEmails() {
  const host = process.env.SMTP_HOST || '127.0.0.1';
  const port = parseInt(process.env.SMTP_PORT || '1025', 10);

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: false,
    tls: { rejectUnauthorized: false },
  });

  const targetEmail = 'student@meetifyy.app';
  const from = 'Meetifyy <noreply@meetifyy.app>';

  const emails = [
    {
      type: 'Welcome Email',
      subject: 'Welcome to Meetifyy! 🎉',
      component: createElement(WelcomeEmail, { name: 'Alex Johnson' }),
    },
    {
      type: 'Verification OTP Email',
      subject: 'Your Meetifyy Verification Code',
      component: createElement(VerificationOtpEmail, { name: 'Alex Johnson', otp: '849201' }),
    },
    {
      type: 'Super Admin Security OTP',
      subject: 'Super Admin Access Code',
      component: createElement(AdminOtpEmail, { name: 'Super Admin Sarthak', otp: '930124' }),
    },
    {
      type: 'New Login Alert Email',
      subject: 'New Login to Your Meetifyy Account',
      component: createElement(NewLoginEmail, {
        name: 'Alex Johnson',
        device: 'MacBook Pro 16"',
        browser: 'Chrome 126.0',
        os: 'macOS Sonoma (14.5)',
        ip: '192.168.1.105',
        time: 'Today at 8:30 PM',
      }),
    },
    {
      type: 'Reset Password Email',
      subject: 'Reset Your Meetifyy Password',
      component: createElement(ResetPasswordEmail, {
        name: 'Alex Johnson',
        resetLink: 'https://meetifyy.com/reset-password?token=sample_reset_token_30min',
      }),
    },
    {
      type: 'Password Changed Email',
      subject: 'Your Meetifyy Password Was Changed',
      component: createElement(PasswordChangedEmail, {
        name: 'Alex Johnson',
        time: 'Today at 8:30 PM',
        device: 'Chrome on macOS',
      }),
    },
  ];

  console.log(`Sending ${emails.length} updated email templates to Mailpit at ${host}:${port}...`);

  for (const item of emails) {
    const html = await render(item.component);
    const info = await transporter.sendMail({
      from,
      to: targetEmail,
      subject: item.subject,
      html,
    });
    console.log(`[Sent] ${item.type} | Subject: "${item.subject}" | ID: ${info.messageId}`);
  }

  console.log('\nAll updated email templates delivered to Mailpit!');
}

sendAllTestEmails().catch((err) => {
  console.error('Error sending test emails to Mailpit:', err);
  process.exit(1);
});
