-- Help-centre copy for open signup (docs/college-affiliation.md):
--   * anyone signs up with any email address, personal or college;
--   * Campus needs a college email verified on the Campus page (one per account);
--   * the live selfie + ID verification gates messaging, creating posts,
--     communities and activities, and Instant Match — not Campus;
--   * an existing account can switch its sign-in address to a personal email in
--     Settings, Email.
--
-- Content only: no schema change, nothing deleted, no user data touched.
--
-- Same rules as 00000000000010:
--   * a correction only touches a row nobody has edited since it was seeded
--     ("updatedAt" = "createdAt"; any Admin Dashboard edit moves "updatedAt"),
--     and keeps that equality so a later correction can still recognise it;
--   * new articles are ON CONFLICT ("slug") DO NOTHING;
--   * every statement matches by stable slug, so re-running is a no-op and a
--     database where a slug or the category is missing simply skips it.
-- Edited rows are left alone on purpose; an admin reviews those by hand.

-- ── Corrections ─────────────────────────────────────────────────────────────

UPDATE "HelpArticle"
SET "question" = 'How do I create a Meetifyy account?',
    "summary" = 'Sign up with any email address you use, personal or college, confirm it with the 6-digit code we send, set a password and add a photo.',
    "body" = '<p>Signing up takes a couple of minutes:</p>
<ol><li>Choose <strong>Sign up</strong> and enter your name, a username, your date of birth and your gender.</li>
<li>Enter your <strong>email address</strong>. Any address you use works, personal or college. This is the address you sign in with.</li>
<li>Create a password.</li>
<li>Enter the 6-digit code we email you. Only the newest code works, so if you asked for another one, use the latest email.</li>
<li>Add a profile photo, or pick one of the preset characters.</li></ol>
<p>You must be 18 or older to use Meetifyy.</p>
<p><strong>Student?</strong> After signing up, open <strong>Campus</strong> and verify your college email to join your college''s directory, communities and events. Signing up with a college address does not do this on its own.</p>
<p>To send messages, post, create communities or activities and use Instant Match, verify your account with a selfie and an ID photo (Settings, Account, Account Verification).</p>',
    "keywords" = ARRAY['sign up','signup','register','new account','create account','email','personal email','college email','code']::TEXT[],
    "updatedAt" = "createdAt"
WHERE "slug" = 'how-do-i-create-a-meetifyy-account' AND "updatedAt" = "createdAt";

UPDATE "HelpArticle"
SET "question" = 'How does account verification work?',
    "summary" = 'Send a live selfie and a photo of your ID from Settings. Verification unlocks messaging, posting, creating communities and activities, and Instant Match.',
    "body" = '<p>Verification confirms a real person is behind the account. Go to Settings, then Account, then <strong>Account Verification</strong>, and send:</p>
<ul><li>a live <strong>selfie</strong> taken with your camera, and</li>
<li>a photo of your <strong>ID card</strong>.</li></ul>
<p>Only the Meetifyy review team can see these photos. While your request is reviewed your status shows as pending. If it is turned down, the reason is shown and you can send it again.</p>
<p>A verified account can send messages and join group chats, create posts, communities and activities, and use Instant Match. Everything else, such as liking, commenting, following and joining communities and activities, works without it.</p>
<p><strong>Campus is separate.</strong> Your college''s directory, communities and events open when you verify your college email on the Campus page, not through this verification.</p>',
    "keywords" = ARRAY['verify','verification','selfie','id card','verified','pending','rejected','messaging','post']::TEXT[],
    "updatedAt" = "createdAt"
WHERE "slug" = 'how-does-account-verification-work' AND "updatedAt" = "createdAt";

UPDATE "HelpArticle"
SET "question" = 'How do I change my profile information?',
    "summary" = 'Settings, Account, Edit Profile for your name, bio and birthday. Tap your photo or cover on your profile to change them.',
    "body" = '<ul><li><strong>Display name, bio and birthday:</strong> Settings, then Account, then <strong>Edit Profile</strong>. Remember to tap Save Changes.</li>
<li><strong>Profile photo and cover:</strong> open your own profile and tap your photo or your cover image.</li>
<li><strong>Course, branch and passing year:</strong> Settings, then Account, then <strong>Academic Info</strong>.</li>
<li><strong>Interests:</strong> Settings, then <strong>Interests &amp; Topics</strong>. These shape your feed and who is suggested to you.</li>
<li><strong>Sign-in email:</strong> Settings, then <strong>Email</strong>.</li></ul>
<p>Your <strong>username</strong> cannot be changed. Your <strong>college</strong> comes from the college email you verified on the Campus page. If you have moved college, verify your new college email there.</p>',
    "keywords" = ARRAY['edit profile','change name','change photo','update bio','avatar','display name','cover','username','college']::TEXT[],
    "updatedAt" = "createdAt"
WHERE "slug" = 'how-do-i-change-my-profile-information' AND "updatedAt" = "createdAt";

UPDATE "HelpArticle"
SET "question" = 'What is Instant Match?',
    "summary" = 'Pick something you want to do and when, and Instant Match pairs you with someone for a 24-hour chat.',
    "body" = '<p>Instant Match finds someone who wants to do the same thing, right now.</p>
<ol><li>Open Instant Match and pick an activity.</li>
<li>Choose when you want to meet and add a short line about yourself.</li>
<li>Location is optional. It only helps rank who is closest, and your exact spot is never shown to anyone.</li></ol>
<p>When you are matched, a private chat opens for <strong>24 hours</strong>, then closes. You can start a new search whenever you like. Instant Match needs a verified account (a selfie and an ID photo, from Settings, Account, Account Verification).</p>
<p>Meeting up? Pick somewhere public and tell a friend where you are going.</p>',
    "updatedAt" = "createdAt"
WHERE "slug" = 'what-is-instant-match' AND "updatedAt" = "createdAt";

UPDATE "HelpArticle"
SET "body" = '<p><strong>Campus events</strong> (Campus, then Events) list what is happening at your college: date and time, venue, who is hosting and, where there is one, a registration link. Campus opens once you verify your college email on the Campus page. To add an event, tap <strong>Create event</strong>, fill it in and publish it. Registration, if the event needs it, happens on the organiser''s own link.</p>
<p><strong>Crew activities</strong> (Find Your Crew) are smaller plans, like a study session or a game, that people can join. Tap <strong>New activity</strong> to host one and set how many people can come; hosting needs a verified account. You can invite people directly, and leave an activity you joined at any time.</p>
<p>Meeting someone new? Meet somewhere public, tell a friend where you are going, and leave if anything feels wrong.</p>',
    "updatedAt" = "createdAt"
WHERE "slug" = 'how-do-i-create-or-join-an-event' AND "updatedAt" = "createdAt";

UPDATE "HelpArticle"
SET "body" = '<p>Try these in order — most sign-in problems are one of the first three:</p>
<ul>
<li><strong>Check the email address.</strong> If you have more than one address, you may be trying the one you didn''t sign up with. If you added a personal email in Settings, Email, sign in with that one: your college email no longer signs you in.</li>
<li><strong>Reset your password.</strong> Choose <em>Forgot password</em> on the sign-in screen. The reset link is valid for a limited time — request a fresh one if it has expired.</li>
<li><strong>Confirm your email is verified.</strong> An unverified account can''t sign in. See the article on verification emails if the code never arrived.</li>
<li><strong>Try a different browser or device</strong> to rule out a stored session or an extension interfering.</li>
</ul>
<p>If none of that works, your account may have been suspended, or there may be a fault on our side. Send us a support request from this page — you don''t need to be signed in to do it. Include the email address on the account and roughly when the problem started.</p>
<p><strong>We will never ask you for your password</strong>, a verification code, or a reset link. Don''t include any of them in a support request.</p>',
    "updatedAt" = "createdAt"
WHERE "slug" = 'i-cant-log-into-my-account' AND "updatedAt" = "createdAt";

UPDATE "HelpArticle"
SET "body" = '<p>Verification codes usually arrive within a minute. If yours hasn''t:</p>
<ul>
<li><strong>Check your spam or junk folder</strong>, and any "Promotions"-style tab your provider uses.</li>
<li><strong>Check the address for typos.</strong> A single wrong character sends the code somewhere else entirely.</li>
<li><strong>Request a new code.</strong> Older codes stop working once a new one is issued, so always use the most recent email.</li>
<li><strong>College address?</strong> Some institutions filter mail from outside senders, so ours may be held there. Check with your college''s IT.</li>
</ul>
<p>Still nothing after ten minutes? Send us a support request with the exact address you''re trying to verify.</p>',
    "updatedAt" = "createdAt"
WHERE "slug" = 'why-am-i-not-receiving-my-verification-email' AND "updatedAt" = "createdAt";

-- ── New articles ────────────────────────────────────────────────────────────

INSERT INTO "HelpArticle" ("id","slug","categoryId","question","summary","body","keywords","sortOrder","isFeatured","status","createdAt","updatedAt","publishedAt")
SELECT gen_random_uuid(), 'how-do-i-join-my-colleges-campus', c."id", 'How do I join my college''s Campus?', 'Open Campus, pick your college and verify your college email with the 6-digit code we send. One college email per account.',
  '<p>Campus is your college''s own space on Meetifyy: its directory, campus communities and campus events. To join it:</p>
<ol><li>Open <strong>Campus</strong>.</li>
<li>Pick your college and enter your <strong>college email address</strong>. It has to be on your college''s own domain.</li>
<li>Enter the 6-digit code we email to that address.</li></ol>
<p>This works whatever email you signed up with. Signing up with a college address does not join Campus by itself.</p>
<ul><li><strong>One college email per account</strong>, and each college email can belong to only one account. If yours says it cannot be used, send us a request from Help &amp; Support.</li>
<li><strong>Moved college?</strong> Verify your new college email on the Campus page; it replaces the old one.</li>
<li><strong>College not in the list?</strong> It is not on Meetifyy yet. You can ask for it to be added.</li></ul>
<p>Campus does not need the selfie verification. Sending messages, posting and creating communities or activities do.</p>',
  ARRAY['campus','college','college email','join campus','directory','campus events','verify college']::TEXT[], 6, true, 'PUBLISHED', NOW(), NOW(), NOW()
FROM "HelpCategory" c WHERE c."slug" = 'account-login'
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpArticle" ("id","slug","categoryId","question","summary","body","keywords","sortOrder","isFeatured","status","createdAt","updatedAt","publishedAt")
SELECT gen_random_uuid(), 'adding-a-personal-email', c."id", 'How do I sign in with a personal email instead of my college email?', 'Settings, Email: enter your personal address, confirm it with the code we send and your password. Your college email stays on your Campus.',
  '<p>If you signed up with your college email, you can switch your sign-in address to a personal one, so you keep your account after you leave college.</p>
<ol><li>Go to <strong>Settings</strong>, then <strong>Email</strong>.</li>
<li>Enter your personal email address and enter the 6-digit code we send to it.</li>
<li>Confirm with your current password.</li></ol>
<p>From then on you sign in with the personal address. Your college email stays verified for your Campus, and we send a security notice to your old address so you know the change happened.</p>
<p>Didn''t make this change? Contact support from Help &amp; Support straight away.</p>',
  ARRAY['personal email','change email','sign in email','login email','college email','gmail','email']::TEXT[], 7, false, 'PUBLISHED', NOW(), NOW(), NOW()
FROM "HelpCategory" c WHERE c."slug" = 'account-login'
ON CONFLICT ("slug") DO NOTHING;
