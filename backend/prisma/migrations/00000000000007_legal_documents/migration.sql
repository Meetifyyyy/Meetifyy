-- Admin-managed legal documents: versioned Terms, Privacy Policy, Cookie Policy
-- and Community Guidelines, plus the per-user record of which exact version was
-- accepted.
--
-- Two tables, and the split is the point:
--   LegalDocumentVersion  — the immutable text. A published row is never
--                           updated; superseding it inserts a new row.
--   LegalAcknowledgement  — the immutable fact that one user accepted one of
--                           those rows. Insert-only, so "accepted Terms v3"
--                           stays true after v4 ships.
--
-- The unique index on (documentType, versionNumber) is what stops two admins
-- publishing the same version number concurrently — the second insert fails
-- rather than producing two "v4"s.

-- CreateEnum
CREATE TYPE "LegalDocumentType" AS ENUM ('TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'COOKIE_POLICY', 'COMMUNITY_GUIDELINES');

-- CreateEnum
CREATE TYPE "LegalDocumentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
-- CreateTable
CREATE TABLE "LegalDocumentVersion" (
    "id" TEXT NOT NULL,
    "documentType" "LegalDocumentType" NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "content" TEXT NOT NULL,
    "status" "LegalDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "requiresAcknowledgement" BOOLEAN NOT NULL DEFAULT false,
    "changeSummary" TEXT,
    "effectiveAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "restoredFromVersionId" TEXT,

    CONSTRAINT "LegalDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalAcknowledgement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentType" "LegalDocumentType" NOT NULL,
    "versionId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" VARCHAR(300),

    CONSTRAINT "LegalAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LegalDocumentVersion_documentType_versionNumber_idx" ON "LegalDocumentVersion"("documentType", "versionNumber" DESC);

-- CreateIndex
CREATE INDEX "LegalDocumentVersion_documentType_isCurrent_idx" ON "LegalDocumentVersion"("documentType", "isCurrent");

-- CreateIndex
CREATE INDEX "LegalDocumentVersion_isCurrent_requiresAcknowledgement_idx" ON "LegalDocumentVersion"("isCurrent", "requiresAcknowledgement");

-- CreateIndex
CREATE UNIQUE INDEX "LegalDocumentVersion_documentType_versionNumber_key" ON "LegalDocumentVersion"("documentType", "versionNumber");

-- CreateIndex
CREATE INDEX "LegalAcknowledgement_userId_idx" ON "LegalAcknowledgement"("userId");

-- CreateIndex
CREATE INDEX "LegalAcknowledgement_versionId_idx" ON "LegalAcknowledgement"("versionId");

-- CreateIndex
CREATE INDEX "LegalAcknowledgement_documentType_acknowledgedAt_idx" ON "LegalAcknowledgement"("documentType", "acknowledgedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LegalAcknowledgement_userId_versionId_key" ON "LegalAcknowledgement"("userId", "versionId");

-- AddForeignKey
ALTER TABLE "LegalDocumentVersion" ADD CONSTRAINT "LegalDocumentVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "SuperAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalDocumentVersion" ADD CONSTRAINT "LegalDocumentVersion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "SuperAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalAcknowledgement" ADD CONSTRAINT "LegalAcknowledgement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalAcknowledgement" ADD CONSTRAINT "LegalAcknowledgement_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "LegalDocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Version 1 of each document: the text that was live on the site, imported
-- unchanged.
--
-- Seeded here rather than left to an admin for the same reason the help centre
-- is (see 00000000000002_seed_content): the public pages now read these tables,
-- so an empty table means a blank Terms page on a fresh environment. Idempotent
-- via ON CONFLICT, so re-running never overwrites an admin's later edits.
--
-- `createdById` / `publishedById` are NULL: nobody authored these in the portal,
-- and a fresh database has no SuperAdmin row to point at. The UI renders NULL
-- as "Meetifyy (imported)".
--
-- `requiresAcknowledgement` is false. Every existing user already accepted this
-- text at signup; forcing the whole user base through a consent modal for a
-- migration that changed no words would be dishonest.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "LegalDocumentVersion" (
  "id","documentType","versionNumber","title","subtitle","content","status",
  "isCurrent","requiresAcknowledgement","changeSummary","effectiveAt",
  "createdById","createdAt","updatedAt","publishedById","publishedAt"
) VALUES (
  gen_random_uuid(), 'TERMS_OF_SERVICE', 1, 'Terms of Service', 'The rules and agreements that govern your use of Meetifyy.',
  '<h2>Introduction</h2><p>Welcome to Meetifyy. These Terms of Service ("Terms") form a legally binding agreement between you and Meetifyy ("Meetifyy," "we," "our," or "us") and govern your access to and use of our platform, including our website, web application, and related services (collectively, the "Platform").</p><p>By creating an account or using the Platform, you confirm that you have read, understood, and agree to be bound by these Terms and our associated policies, including the Privacy Policy and Community Guidelines.</p><p>If you do not agree to these Terms, do not use the Platform.</p><h2>1. About Meetifyy</h2><p>Meetifyy is a student platform designed to help college students discover communities, connect with peers who share their interests, attend campus events, find project collaborators, and build meaningful relationships. Signing up requires a valid college or institution email address.</p><h2>2. Eligibility</h2><ul><li>Age: You must be at least 18 years old to create an account.</li><li>Institution Email: You must provide a valid college or institution email address to register.</li><li>Legal Capacity: You must have the legal capacity to enter into a binding agreement.</li><li>Accurate Information: You must provide truthful information at signup and keep it up to date.</li><li>Account Responsibility: You are responsible for keeping your login credentials secure and for all activity that takes place under your account. Notify us immediately at app.meetifyy@gmail.com if you suspect unauthorized access.</li></ul><h2>3. Acceptable Use</h2><p>You agree not to use the Platform to:</p><ul><li>Harass, bully, defame, or threaten any person.</li><li>Post or share illegal, abusive, fraudulent, or obscene content.</li><li>Impersonate another person, organization, or misrepresent your institutional affiliation.</li><li>Distribute spam, phishing links, or malicious software.</li><li>Scrape, mine, or extract data from the Platform without authorization.</li><li>Attempt to gain unauthorized access to any account, system, or network.</li></ul><h2>4. Communities and Events</h2><p>Users may create and join communities and events on the Platform. Community creators and event organizers are responsible for the accuracy of their content, the conduct of their community, and compliance with these Terms and our Community Guidelines. Meetifyy may remove communities, events, or content that violate these Terms at any time.</p><h2>5. Content Ownership and License</h2><p>You retain ownership of the original content you post on Meetifyy. By posting content, you grant Meetifyy a non-exclusive, worldwide, royalty-free license to host, store, display, reproduce, and distribute that content solely as needed to operate and deliver the Platform to other users. This license does not grant Meetifyy the right to use your content in advertising or marketing. You confirm that you have the rights to grant this license and that your content does not infringe the rights of others.</p><h2>6. Meetifyy Intellectual Property</h2><p>All Platform branding, software, visual design, logos, graphics, and trademarks are owned by Meetifyy or its licensors. Nothing in these Terms transfers ownership of any Meetifyy intellectual property to you. You may not copy, reproduce, modify, or distribute our materials without our prior written consent.</p><h2>7. Disclaimer of Warranties</h2><p>The Platform is provided on an "as is" and "as available" basis. To the fullest extent permitted by law, Meetifyy makes no warranties, express or implied, including warranties of merchantability, fitness for a particular purpose, or non-infringement. We do not guarantee that the Platform will always be available, uninterrupted, or free of errors.</p><h2>8. Limitation of Liability</h2><p>To the maximum extent permitted by applicable law, Meetifyy and its founders shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of data or loss of opportunity, arising from your use of the Platform or from interactions with other users.</p><h2>9. Indemnification</h2><p>You agree to indemnify and hold harmless Meetifyy and its founders from any claims, liabilities, damages, or costs (including reasonable legal fees) arising from your violation of these Terms, your content, or your misuse of the Platform.</p><h2>10. Suspension and Termination</h2><p>Meetifyy may suspend or terminate your access to the Platform if you violate these Terms or our Community Guidelines. You may request account closure at any time by contacting us. Account closure requests are processed manually; please contact us at app.meetifyy@gmail.com.</p><h2>11. Governing Law</h2><p>These Terms are governed by the laws of India. Any disputes arising under or in connection with these Terms shall be subject to the exclusive jurisdiction of courts of competent jurisdiction in India. Meetifyy has not yet incorporated as a formal legal entity; this clause will be updated with a specific seat of jurisdiction when incorporation is complete.</p><h2>12. Changes to These Terms</h2><p>We may update these Terms from time to time. When we make material changes, we will notify you through the Platform or by email and update the date at the top of this page. For significant changes, we may ask you to re-acknowledge the updated Terms before continuing. Continued use of the Platform after notification of changes means you accept the revised Terms.</p><h2>13. Contact</h2><p>If you have questions about these Terms or need to contact us regarding your account, please reach out to our team:</p><a href="mailto:app.meetifyy@gmail.com">app.meetifyy@gmail.com</a>',
  'PUBLISHED', true, false,
  'Initial version, imported unchanged from the published site.',
  TIMESTAMP '2026-08-27 00:00:00', NULL,
  -- The publication timestamps are the document's own date, not the moment the
  -- migration happened to run. `publishedAt` is what the public page shows as
  -- "Last updated", and dating imported text to the deploy would claim a change
  -- that did not happen.
  TIMESTAMP '2026-08-27 00:00:00', TIMESTAMP '2026-08-27 00:00:00',
  NULL, TIMESTAMP '2026-08-27 00:00:00'
)
ON CONFLICT ("documentType","versionNumber") DO NOTHING;

INSERT INTO "LegalDocumentVersion" (
  "id","documentType","versionNumber","title","subtitle","content","status",
  "isCurrent","requiresAcknowledgement","changeSummary","effectiveAt",
  "createdById","createdAt","updatedAt","publishedById","publishedAt"
) VALUES (
  gen_random_uuid(), 'PRIVACY_POLICY', 1, 'Privacy Policy', 'How Meetifyy collects, uses, and protects your personal data.',
  '<h2>1. Introduction</h2><p>Welcome to Meetifyy ("Meetifyy," "we," "our," or "us"). This Privacy Policy describes how we collect, use, and handle your personal information when you use the Meetifyy platform, including our website, web application, and related services (collectively, the "Platform").</p><p>By creating an account or using the Platform, you acknowledge that you have read and understood this policy. If you have any questions, please contact us using the details at the end of this document.</p><h2>2. Personal Data We Collect</h2><p>We collect personal information in the following categories:</p><h3>Data You Provide Directly</h3><ul><li><strong>Account Information:</strong> Your full name, username, date of birth, college email address, and password when you register.</li><li><strong>Academic Details:</strong> Your college or university affiliation, course, branch, and current year of study.</li><li><strong>Profile Data:</strong> Your bio, profile photo, cover image, interests, and any other information you choose to add to your profile.</li><li><strong>User-Generated Content:</strong> Posts, comments, messages, media uploads, communities you join or create, events you create or attend, and reports you submit.</li><li><strong>Support Communications:</strong> Your name, email address, and any information you include when contacting our support team.</li></ul><h3>Data Collected Automatically</h3><ul><li><strong>Server Logs:</strong> Our servers may record IP addresses, request timestamps, and other standard HTTP log data as part of routine infrastructure operation and security monitoring.</li></ul><h3>Browser Storage</h3><p>We use browser-side storage technologies (localStorage, sessionStorage, IndexedDB, and Service Worker caches) to keep you signed in, remember your preferences, and make the Platform faster. We do not use traditional tracking cookies, web beacons, or any advertising tracking technologies. We do use cookieless analytics to count page views and measure page speed, which store nothing on your device. For full details, see our <a href="/cookie-policy">Cookie Policy</a>.</p><h2>3. How We Use Your Data</h2><p>We use your personal information for the following purposes:</p><ul><li><strong>Account and Service Delivery:</strong> To create and manage your account, verify your college email, connect you with campus communities and events, and provide direct messaging.</li><li><strong>Transactional Communications:</strong> To send email verification codes, password reset links, account security alerts, and support replies. We do not send promotional or marketing emails.</li><li><strong>Safety and Trust:</strong> To detect abuse, investigate reported content, enforce our Community Guidelines, and respond to legal requests.</li><li><strong>Platform Improvement:</strong> To understand how the Platform is used and to fix problems and improve features.</li></ul><h2>4. Legal Basis for Processing</h2><p>Where applicable under data protection law, we rely on the following legal bases:</p><ul><li><strong>Contract:</strong> To create your account and provide the core features of the Platform you signed up for.</li><li><strong>Legitimate Interests:</strong> To maintain security, prevent abuse, improve the Platform, and provide customer support.</li><li><strong>Legal Obligations:</strong> To comply with applicable laws and respond to lawful requests from authorities.</li></ul><h2>5. Data Sharing</h2><p>We do not sell your personal information.</p><p>We share your data only in the following limited circumstances:</p><ul><li><strong>Other Users:</strong> Information you post in public communities, event pages, or on your public profile is visible to other registered users of the Platform.</li><li><strong>Infrastructure Providers:</strong> We use Supabase for authentication and database services, Cloudflare R2 for file storage, Resend for transactional email delivery, and Vercel for hosting and cookieless analytics. These providers process data only on our behalf and under our instructions. No advertising providers receive your data, and Vercel receives only anonymous page-view and page-performance measurements.</li><li><strong>Legal and Safety Requirements:</strong> When required by law or to protect the safety, rights, or property of users or the public.</li><li><strong>Business Transfers:</strong> In the event of a merger, acquisition, or transfer of Meetifyy''s operations, your data may transfer as part of that transaction. We will notify you if this occurs.</li></ul><h2>6. Your Privacy Rights</h2><p>Depending on your jurisdiction, you may have the following rights regarding your personal data:</p><ul><li><strong>Access:</strong> You can request a copy of the personal data we hold about you.</li><li><strong>Rectification:</strong> You can correct inaccurate or incomplete information through your account settings or by contacting us.</li><li><strong>Erasure:</strong> You can request the deletion of your account and associated personal data by contacting us. We will process deletion requests in accordance with our obligations and technical capabilities.</li><li><strong>Non-Discrimination:</strong> We will not treat you differently for exercising your privacy rights.</li></ul><p>Meetifyy does not currently sell personal information, and does not share personal information for cross-context behavioral advertising purposes.</p><p>To exercise any of these rights, contact us at the address below.</p><h2>7. Data Retention</h2><p>We retain your personal data for as long as your account is active and as necessary to provide the Platform, comply with legal obligations, resolve disputes, and enforce our agreements. Some data may be retained after account closure where required by law or for legitimate safety and operational reasons (for example, moderation records and reports related to serious violations).</p><p>If you wish to request deletion of your data, please contact us directly.</p><h2>8. Security</h2><p>We take reasonable technical and organizational measures to protect your data. Authentication is handled through Supabase, which issues cryptographically signed session tokens. Passwords are never stored by Meetifyy; they are managed entirely by Supabase Auth. Data is transmitted over HTTPS. File uploads are stored in Cloudflare R2, a managed object storage service. Authentication endpoints are served without service worker caching to prevent sensitive tokens from being stored in browser cache.</p><p>No system is completely secure. We encourage you to use a strong password and to contact us immediately if you suspect unauthorized access to your account.</p><h2>9. Children''s Privacy</h2><p>Meetifyy requires all users to be at least 18 years old and to verify a college or institution email address to sign up. We do not knowingly collect personal data from anyone under 18. If we become aware that a user under 18 has registered, we will close the account and remove their data.</p><h2>10. Changes to This Policy</h2><p>We may update this Privacy Policy from time to time. When we make material changes, we will update the date at the top of this page and may notify you through the Platform or by email. We encourage you to review this policy periodically.</p><h2>11. Contact Us</h2><p>If you have questions about this Privacy Policy or wish to exercise your data rights, please reach out to us at:</p><a href="mailto:app.meetifyy@gmail.com">app.meetifyy@gmail.com</a>',
  'PUBLISHED', true, false,
  'Initial version, imported unchanged from the published site.',
  TIMESTAMP '2026-08-27 00:00:00', NULL,
  -- The publication timestamps are the document's own date, not the moment the
  -- migration happened to run. `publishedAt` is what the public page shows as
  -- "Last updated", and dating imported text to the deploy would claim a change
  -- that did not happen.
  TIMESTAMP '2026-08-27 00:00:00', TIMESTAMP '2026-08-27 00:00:00',
  NULL, TIMESTAMP '2026-08-27 00:00:00'
)
ON CONFLICT ("documentType","versionNumber") DO NOTHING;

INSERT INTO "LegalDocumentVersion" (
  "id","documentType","versionNumber","title","subtitle","content","status",
  "isCurrent","requiresAcknowledgement","changeSummary","effectiveAt",
  "createdById","createdAt","updatedAt","publishedById","publishedAt"
) VALUES (
  gen_random_uuid(), 'COOKIE_POLICY', 1, 'Cookie Policy', 'How Meetifyy uses browser storage to keep you signed in, remember your preferences, and make the app fast.',
  '<h2>Introduction</h2><p>This Cookie Policy explains how Meetifyy ("Meetifyy," "we," "our," or "us") uses browser storage technologies when you use our platform and related services (collectively, the "Platform"). Despite the name, Meetifyy does not use traditional HTTP tracking cookies for authentication or analytics. Instead, we rely on browser-side storage APIs (localStorage, sessionStorage, IndexedDB, and Service Worker caches) to deliver and support the Platform''s features. This policy is supplementary to and should be read alongside our <a href="/privacy-policy">Privacy Policy</a>.</p><h2>1. What Storage Technologies We Use</h2><p>We do not use HTTP cookies set by a web server for tracking or advertising purposes, and the cookieless analytics described in section 4 set no cookie either. The following browser storage mechanisms are used:</p><ul><li><strong>localStorage:</strong> Persistent key-value storage that survives browser restarts. Used for your authentication session token (managed by Supabase), a lightweight user profile cache, your theme preference, recent search history, muted communities, and other functional preferences.</li><li><strong>sessionStorage:</strong> Temporary key-value storage cleared when the browser tab is closed. Used for signup and onboarding progress, password-reset security state, post-login redirect intents, navigation history state, and internal failover flags.</li><li><strong>IndexedDB:</strong> A structured browser database with two distinct uses. The first is a content cache ("meetifyy_cache") that stores your feed, community, activity, and profile data locally so pages load quickly from cached results while fresh data is fetched in the background. Every cached entry has a time-to-live and the entire cache is cleared when you sign out. The second is a message outbox ("meetifyy_outbox") used by the Service Worker to queue outgoing messages when you are briefly offline, so they can be sent once your connection is restored.</li><li><strong>Service Worker Cache Storage:</strong> Used to cache static app assets (JavaScript, CSS bundles, images) and Google Fonts so the app loads quickly and works reliably on slow or unstable connections. API responses for feeds and communities are also cached in a separate network-first cache and cleared on sign-out.</li></ul><h2>2. Categories of Storage We Use</h2><h3>Essential Authentication and Security</h3><p>Required to keep you signed in and your account secure. Supabase, our authentication provider, stores a signed session token in localStorage. We also store a lightweight profile cache to load the app without an extra round-trip. These are necessary to use your account and cannot be disabled.</p><h3>Functional Application Storage</h3><p>Stores your personal preferences between sessions: your light or dark theme, recent searches, muted communities, video volume, and view mode settings. This data is not shared with third parties and is not used for tracking.</p><h3>Offline and Performance Storage</h3><p>Caches feeds, communities, activities, and profiles in IndexedDB so that pages render immediately from local data while fresh content is loaded in the background. Caches static assets and API responses via the Service Worker so the app is fast on poor connections and can continue functioning briefly when offline. Google Fonts (Inter) are downloaded from Google servers on the first visit and then cached locally by the Service Worker using a cache-first strategy with a one-year expiry, which prevents repeated requests to Google on subsequent visits. All performance caches are cleared when you sign out.</p><h3>Temporary Application State</h3><p>Short-lived data stored for the duration of a browser session, including multi-step signup and onboarding progress, password-reset state, and internal navigation tracking. All sessionStorage data is cleared automatically when you close the browser tab.</p><h2>3. Third-Party Services</h2><p>Meetifyy integrates the following external services. <strong>No advertising networks or cross-site tracking services are used.</strong></p><ul><li><strong>Supabase:</strong> Provides authentication and database services. The Supabase JavaScript client manages your session token in localStorage. Their processing is governed by the <a href="https://supabase.com/privacy">Supabase Privacy Policy</a>.</li><li><strong>Google Fonts:</strong> On your first visit, the browser downloads the Inter typeface from Google font servers. This request may log your IP address per standard Google server logs. After the first load, the font is served from the Service Worker cache and no further requests are made to Google. Google''s processing is governed by the <a href="https://policies.google.com/privacy">Google Privacy Policy</a>.</li><li><strong>Cloudflare R2:</strong> Stores uploaded media files (profile photos, cover images, post attachments). Media is served directly from Cloudflare''s content delivery network. Their processing is governed by the <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare Privacy Policy</a>.</li><li><strong>Vercel:</strong> Hosts the Platform and provides the cookieless Web Analytics and Speed Insights described in section 4. These count page views and measure page-load speed without setting a cookie or storing any identifier on your device. Their processing is governed by the <a href="https://vercel.com/legal/privacy-policy">Vercel Privacy Policy</a>.</li></ul><h2>4. Analytics and Advertising</h2><p>We use <strong>Vercel Web Analytics</strong> and <strong>Vercel Speed Insights</strong>, provided by our hosting provider, to count page views and measure how quickly pages load. Both are <strong>cookieless</strong>: they set no cookie, store no identifier on your device, and cannot recognise you when you return or follow you to another website.</p><p>What they record is limited to the page visited, the referring page, your approximate location at country level, your device and browser type, and page-performance timings.</p><p>Meetifyy does <strong>not</strong> use Google Analytics, Facebook Pixel, or any advertising tracking service. We do not build advertising profiles, sell your data, or use cross-site tracking technologies.</p><h2>5. Managing Your Storage</h2><p>All storage used by Meetifyy supports core features, preferences, and performance. The analytics described in section 4 store nothing on your device, so there is no tracking identifier to clear or opt out of. You can view a summary of the storage categories we use:</p>View Storage Details<p>You can clear all browser storage associated with Meetifyy at any time by clearing your browser''s site data for this site. Doing so will sign you out and reset all locally stored preferences.</p><h2>6. Changes to This Cookie Policy</h2><p>We may update this Cookie Policy when our technical infrastructure changes or when legal obligations require it. We will update the date at the top of this page when changes are made.</p><h2>7. Contact Us</h2><p>If you have questions about our use of browser storage technologies, please contact us:</p><a href="mailto:app.meetifyy@gmail.com">app.meetifyy@gmail.com</a>',
  'PUBLISHED', true, false,
  'Initial version, imported unchanged from the published site.',
  TIMESTAMP '2026-08-27 00:00:00', NULL,
  -- The publication timestamps are the document's own date, not the moment the
  -- migration happened to run. `publishedAt` is what the public page shows as
  -- "Last updated", and dating imported text to the deploy would claim a change
  -- that did not happen.
  TIMESTAMP '2026-08-27 00:00:00', TIMESTAMP '2026-08-27 00:00:00',
  NULL, TIMESTAMP '2026-08-27 00:00:00'
)
ON CONFLICT ("documentType","versionNumber") DO NOTHING;

INSERT INTO "LegalDocumentVersion" (
  "id","documentType","versionNumber","title","subtitle","content","status",
  "isCurrent","requiresAcknowledgement","changeSummary","effectiveAt",
  "createdById","createdAt","updatedAt","publishedById","publishedAt"
) VALUES (
  gen_random_uuid(), 'COMMUNITY_GUIDELINES', 1, 'Community Guidelines', 'The standards that keep Meetifyy safe, respectful, and worth showing up to.',
  '<h2>Our Shared Commitment</h2><p>Meetifyy exists to help students find their people: study partners, collaborators, friends, and communities that share their interests. That only works if everyone here acts in good faith.</p><p>These Guidelines describe the behavior we expect from every person on the Platform. They apply to all content and interactions, whether in public communities, private messages, or event pages. By using Meetifyy, you agree to follow them.</p><h2>1. Treat Others with Respect</h2><p>Engage with other members of the Meetifyy community with basic courtesy and respect. Healthy disagreement is welcome; personal attacks, sustained insults, and intimidation are not.</p><h2>2. No Bullying or Harassment</h2><p>Do not bully, threaten, stalk, or repeatedly contact someone who has asked you to stop. Organizing or encouraging others to target a specific person or group is prohibited.</p><h2>3. No Hate Speech or Discrimination</h2><p>Meetifyy is open to students of every background. Do not post content that promotes hatred, incites violence, or discriminates against any person or group on the basis of race, ethnicity, national origin, religion, gender, gender identity, disability, or sexual orientation.</p><h2>4. Keep Content Appropriate</h2><p>Do not share sexually explicit material, non-consensual intimate imagery, graphic violence, or illegal content. Do not post content that promotes, glorifies, or provides instructions for self-harm, suicide, or dangerous activities. Educational, harm-reduction, and recovery-oriented discussion is permitted.</p><h2>5. Be Honest About Who You Are</h2><p>Do not impersonate another person, student organization, or institution. Do not create accounts with false identities or misrepresent your institutional affiliation to deceive others.</p><h2>6. Respect Personal Privacy</h2><p>Do not share another person''s private information without their permission. This includes home or dorm addresses, phone numbers, private email addresses, identity documents, and screenshots of private conversations. Sharing such information without consent, regardless of where it was originally obtained, is not allowed.</p><h2>7. No Spam, Scams, or Deception</h2><p>Do not send unsolicited bulk messages, phishing links, or fraudulent offers. Excessive self-promotion and the use of automated accounts or scripts to manipulate engagement are prohibited.</p><h2>8. Community and Event Responsibility</h2><p>Community creators and event organizers are responsible for providing accurate information and keeping their communities and events in compliance with these Guidelines. Meetifyy may remove or close communities and events that breach our policies.</p><h2>9. Messaging Etiquette</h2><p>Use direct messages in good faith. Do not send harassing, threatening, or explicitly sexual messages. If someone asks you to stop contacting them or blocks you, respect that. Attempting to circumvent a block is a violation of these Guidelines.</p><h2>10. Respect Intellectual Property</h2><p>Only post or share content you have created yourself or have the right to use. Do not claim ownership of other people''s creative work.</p><h2>11. Reporting Violations</h2><p>If you see content or behavior that violates these Guidelines, use the in-app reporting tools. Reports help us keep the Platform safe. Reported information may be reviewed by Meetifyy staff and, where required by law or safety considerations, shared with relevant authorities.</p><h2>12. Enforcement</h2><p>Violations of these Guidelines may result in content removal, feature restrictions, account suspension, or permanent bans, depending on severity and context. Illegal activity will be reported to law enforcement where required.</p><h2>13. Updates to These Guidelines</h2><p>We may revise these Community Guidelines as the Platform grows. We will update the date at the top of the page when changes are made. Continued use of Meetifyy means you agree to the current version of these Guidelines.</p><h2>14. Contact</h2><p>If you need to escalate a safety concern or have a question about these Guidelines, contact us directly:</p><a href="mailto:app.meetifyy@gmail.com">app.meetifyy@gmail.com</a>',
  'PUBLISHED', true, false,
  'Initial version, imported unchanged from the published site.',
  TIMESTAMP '2026-08-27 00:00:00', NULL,
  -- The publication timestamps are the document's own date, not the moment the
  -- migration happened to run. `publishedAt` is what the public page shows as
  -- "Last updated", and dating imported text to the deploy would claim a change
  -- that did not happen.
  TIMESTAMP '2026-08-27 00:00:00', TIMESTAMP '2026-08-27 00:00:00',
  NULL, TIMESTAMP '2026-08-27 00:00:00'
)
ON CONFLICT ("documentType","versionNumber") DO NOTHING;
