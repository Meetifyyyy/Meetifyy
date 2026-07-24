import { render } from '@react-email/render';
import { createElement } from 'react';
import * as fs from 'fs';
import * as path from 'path';

import { VerificationOtpEmail } from './src/email/templates/verification-otp';
import { ResetPasswordEmail } from './src/email/templates/reset-password';

async function generate() {
  const otpHtml = await render(
    createElement(VerificationOtpEmail, { name: '{{ .Data.name }}', otp: '{{ .Token }}' })
  );
  
  const resetHtml = await render(
    createElement(ResetPasswordEmail, { name: '{{ .Data.name }}', resetLink: '{{ .ConfirmationURL }}' })
  );

  const outDir = path.join(__dirname, 'supabase-templates');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir);
  }

  fs.writeFileSync(path.join(outDir, 'confirm-signup.html'), otpHtml);
  fs.writeFileSync(path.join(outDir, 'reset-password.html'), resetHtml);

  console.log('Templates generated successfully in /supabase-templates');
}

generate().catch(console.error);
