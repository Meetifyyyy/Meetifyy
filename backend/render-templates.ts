/**
 * Renders the Supabase Auth email templates (signup confirmation, password
 * reset) to static HTML for pasting into the Supabase dashboard.
 *
 * These emails are sent by Supabase, not by this backend, so they cannot read
 * configuration at send time — every URL inside them is frozen at render time.
 * That makes the render environment part of the output: rendering under the
 * development environment bakes the dev wordmark and dev.meetifyy.app footer
 * links into HTML that would otherwise look production-ready.
 *
 * Output therefore goes to supabase-templates/<APP_ENV>/, never to a shared
 * directory, so a production template can never be silently overwritten by a
 * development render — and so it is obvious which file belongs in which
 * Supabase project.
 *
 *   npm run render:templates:dev    → supabase-templates/development/
 *   npm run render:templates:prod   → supabase-templates/production/
 *
 * Nothing here is hardcoded: every value comes from SITE_CONFIG, which is built
 * from the environment. Changing a URL means changing an env var and
 * re-rendering, never editing HTML by hand.
 */
import { render } from '@react-email/render';
import { createElement } from 'react';
import * as fs from 'fs';
import * as path from 'path';

import { APP_ENV } from './src/config/env';
import { SITE_CONFIG } from './src/config/site.config';
import { VerificationOtpEmail } from './src/email/templates/verification-otp';
import { ResetPasswordEmail } from './src/email/templates/reset-password';

/** Supabase substitutes these itself when it sends the mail. */
const SUPABASE_VARS = {
  name: '{{ .Data.name }}',
  otp: '{{ .Token }}',
  confirmationUrl: '{{ .ConfirmationURL }}',
};

async function generate() {
  const outDir = path.join(__dirname, 'supabase-templates', APP_ENV);
  fs.mkdirSync(outDir, { recursive: true });

  const files: Array<[string, string]> = [
    [
      'confirm-signup.html',
      await render(
        createElement(VerificationOtpEmail, {
          name: SUPABASE_VARS.name,
          otp: SUPABASE_VARS.otp,
        }),
      ),
    ],
    [
      'reset-password.html',
      await render(
        createElement(ResetPasswordEmail, {
          name: SUPABASE_VARS.name,
          resetLink: SUPABASE_VARS.confirmationUrl,
        }),
      ),
    ],
  ];

  for (const [name, html] of files) {
    fs.writeFileSync(path.join(outDir, name), html);
  }

  // Printed so the baked-in values are auditable at render time rather than
  // discovered in a user's inbox.
  console.log(`Rendered ${files.length} template(s) for APP_ENV="${APP_ENV}"`);
  console.log(`  → supabase-templates/${APP_ENV}/`);
  console.log(`  wordmark : ${SITE_CONFIG.wordmarkUrl}`);
  console.log(`  privacy  : ${SITE_CONFIG.privacyUrl}`);
  console.log(`  terms    : ${SITE_CONFIG.termsUrl}`);

  const leaked = files.filter(([, html]) => /dev\.meetifyy\.app|kiejkkygqrhbrohdlpkp/.test(html));
  if (APP_ENV === 'production' && leaked.length > 0) {
    throw new Error(
      `Production render contains development URLs in: ${leaked
        .map(([n]) => n)
        .join(', ')}. Check FRONTEND_URL and WORDMARK_URL for APP_ENV=production.`,
    );
  }
}

generate().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
