-- Help-centre content, seeded as a migration because the public page reads it
-- from these tables, and a category with no articles is a state the admin UI
-- refuses to publish. Every statement is ON CONFLICT, so re-running is a no-op.

-- from 20260826130000_seed_help_centre_content
-- Initial help-centre content.
--
-- Seeded as a migration rather than hardcoded in the frontend: the public page
-- reads everything from these tables, and this content is editable, reorderable
-- and unpublishable from the Admin Dashboard exactly like anything an admin
-- writes later. It is intentionally idempotent — ON CONFLICT DO NOTHING on the
-- slug — so re-running it never overwrites an admin's edits.


INSERT INTO "HelpCategory" ("id","slug","title","description","icon","sortOrder","status","createdAt","updatedAt","publishedAt")
VALUES (gen_random_uuid(), 'account-login', 'Account & Login', 'Signing up, signing in, passwords and account recovery.', 'KeyRound', 0, 'PUBLISHED', NOW(), NOW(), NOW())
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpCategory" ("id","slug","title","description","icon","sortOrder","status","createdAt","updatedAt","publishedAt")
VALUES (gen_random_uuid(), 'profile-privacy', 'Profile & Privacy', 'Your profile details, who can see them, and blocking.', 'UserCog', 1, 'PUBLISHED', NOW(), NOW(), NOW())
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpCategory" ("id","slug","title","description","icon","sortOrder","status","createdAt","updatedAt","publishedAt")
VALUES (gen_random_uuid(), 'chat-messaging', 'Chat & Messaging', 'Direct messages, group chats and message delivery.', 'MessageCircle', 2, 'PUBLISHED', NOW(), NOW(), NOW())
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpCategory" ("id","slug","title","description","icon","sortOrder","status","createdAt","updatedAt","publishedAt")
VALUES (gen_random_uuid(), 'communities', 'Communities', 'Finding, joining and taking part in communities.', 'Users', 3, 'PUBLISHED', NOW(), NOW(), NOW())
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpCategory" ("id","slug","title","description","icon","sortOrder","status","createdAt","updatedAt","publishedAt")
VALUES (gen_random_uuid(), 'posts-content', 'Posts & Content', 'Creating posts, comments, media and what happens to them.', 'FileText', 4, 'PUBLISHED', NOW(), NOW(), NOW())
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpCategory" ("id","slug","title","description","icon","sortOrder","status","createdAt","updatedAt","publishedAt")
VALUES (gen_random_uuid(), 'events-activities', 'Events & Activities', 'Campus events, crew activities and meeting up.', 'CalendarDays', 5, 'PUBLISHED', NOW(), NOW(), NOW())
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpCategory" ("id","slug","title","description","icon","sortOrder","status","createdAt","updatedAt","publishedAt")
VALUES (gen_random_uuid(), 'notifications', 'Notifications', 'Push, email and in-app notification settings.', 'Bell', 6, 'PUBLISHED', NOW(), NOW(), NOW())
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpCategory" ("id","slug","title","description","icon","sortOrder","status","createdAt","updatedAt","publishedAt")
VALUES (gen_random_uuid(), 'safety-reporting', 'Safety & Reporting', 'Reporting people, content and unsafe meetups.', 'ShieldCheck', 7, 'PUBLISHED', NOW(), NOW(), NOW())
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpCategory" ("id","slug","title","description","icon","sortOrder","status","createdAt","updatedAt","publishedAt")
VALUES (gen_random_uuid(), 'technical-issues', 'Technical Issues', 'Something is broken, slow or not loading.', 'Wrench', 8, 'PUBLISHED', NOW(), NOW(), NOW())
ON CONFLICT ("slug") DO NOTHING;



INSERT INTO "HelpArticle" ("id","slug","categoryId","question","summary","body","keywords","sortOrder","isFeatured","status","createdAt","updatedAt","publishedAt")
SELECT gen_random_uuid(), 'how-do-i-create-a-meetifyy-account', c."id", 'How do I create a Meetifyy account?', 'Sign up with your college email address, verify it with the code we send, then finish your profile.',
  '<p>Creating an account takes a couple of minutes:</p>
<ol><li>Open Meetifyy and choose <strong>Sign up</strong>.</li>
<li>Enter your college email address. Meetifyy uses your college domain to place you on the right campus, so use your institutional address rather than a personal one where you have the choice.</li>
<li>We''ll email you a 6-digit verification code. Enter it to confirm the address belongs to you.</li>
<li>Pick a username and a display name, then add a photo and your interests so people can find you.</li></ol>
<p>If your college isn''t listed when you sign up, it may not be onboarded yet — send us a support request with your college name and we''ll look into adding it.</p>',
  ARRAY['sign up','signup','register','new account','create account','join']::TEXT[], 0, true, 'PUBLISHED', NOW(), NOW(), NOW()
FROM "HelpCategory" c WHERE c."slug" = 'account-login'
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpArticle" ("id","slug","categoryId","question","summary","body","keywords","sortOrder","isFeatured","status","createdAt","updatedAt","publishedAt")
SELECT gen_random_uuid(), 'i-cant-log-into-my-account', c."id", 'I can''t log into my account. What should I do?', 'Work through the common causes below — wrong address, unverified email, caps lock, or a suspended account — then reset your password or contact support.',
  '<p>Try these in order — most sign-in problems are one of the first three:</p>
<ul>
<li><strong>Check the email address.</strong> If you have more than one address, you may be trying the one you didn''t sign up with.</li>
<li><strong>Reset your password.</strong> Choose <em>Forgot password</em> on the sign-in screen. The reset link is valid for a limited time — request a fresh one if it has expired.</li>
<li><strong>Confirm your email is verified.</strong> An unverified account can''t sign in. See the article on verification emails if the code never arrived.</li>
<li><strong>Try a different browser or device</strong> to rule out a stored session or an extension interfering.</li>
</ul>
<p>If none of that works, your account may have been suspended, or there may be a fault on our side. Send us a support request from this page — you don''t need to be signed in to do it. Include the email address on the account and roughly when the problem started.</p>
<p><strong>We will never ask you for your password</strong>, a verification code, or a reset link. Don''t include any of them in a support request.</p>',
  ARRAY['cant login','can''t log in','locked out','sign in problem','login failed','password wrong']::TEXT[], 1, true, 'PUBLISHED', NOW(), NOW(), NOW()
FROM "HelpCategory" c WHERE c."slug" = 'account-login'
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpArticle" ("id","slug","categoryId","question","summary","body","keywords","sortOrder","isFeatured","status","createdAt","updatedAt","publishedAt")
SELECT gen_random_uuid(), 'why-am-i-not-receiving-my-verification-email', c."id", 'Why am I not receiving my verification email?', 'Check spam, wait a few minutes, confirm the address is spelled correctly, and request a new code.',
  '<p>Verification codes usually arrive within a minute. If yours hasn''t:</p>
<ul>
<li><strong>Check your spam or junk folder</strong>, and any "Promotions"-style tab your provider uses.</li>
<li><strong>Check the address for typos.</strong> A single wrong character sends the code somewhere else entirely.</li>
<li><strong>Request a new code.</strong> Older codes stop working once a new one is issued, so always use the most recent email.</li>
<li><strong>Check with your college''s IT.</strong> Some institutions filter mail from outside senders; ours may be held there.</li>
</ul>
<p>Still nothing after ten minutes? Send us a support request with the exact address you''re trying to verify.</p>',
  ARRAY['verification email','otp not received','code not arriving','confirm email','no email']::TEXT[], 2, true, 'PUBLISHED', NOW(), NOW(), NOW()
FROM "HelpCategory" c WHERE c."slug" = 'account-login'
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpArticle" ("id","slug","categoryId","question","summary","body","keywords","sortOrder","isFeatured","status","createdAt","updatedAt","publishedAt")
SELECT gen_random_uuid(), 'how-do-i-delete-my-account', c."id", 'How do I delete my account?', 'Settings → Account → Delete account. Deletion is permanent and removes your profile, posts and messages.',
  '<p>Go to <strong>Settings → Account → Delete account</strong> and confirm.</p>
<p>Deleting your account is permanent. It removes your profile, your posts and comments, and your side of your conversations. Some records are kept where we''re required to — for example, safety reports made about your account, so that a report can''t be erased by deleting the account it concerns.</p>
<p>If you''d rather take a break than leave, consider making your profile private instead — that keeps your account and your history intact.</p>
<p>If you can''t reach Settings because you can''t sign in, send us a support request from the address on the account and we''ll help.</p>',
  ARRAY['delete account','close account','remove account','deactivate','erase data']::TEXT[], 3, false, 'PUBLISHED', NOW(), NOW(), NOW()
FROM "HelpCategory" c WHERE c."slug" = 'account-login'
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpArticle" ("id","slug","categoryId","question","summary","body","keywords","sortOrder","isFeatured","status","createdAt","updatedAt","publishedAt")
SELECT gen_random_uuid(), 'how-do-i-change-my-profile-information', c."id", 'How do I change my profile information?', 'Open your profile and choose Edit profile to change your photo, display name, bio, interests and course details.',
  '<p>Open your profile and choose <strong>Edit profile</strong>. From there you can change your display name, username, bio, profile photo, cover image, interests and course details.</p>
<p>A few things to know:</p>
<ul>
<li>Your <strong>username</strong> is what appears in links to your profile. Changing it means old links stop working.</li>
<li>Your <strong>college</strong> is set from your verified email address and can''t be changed by editing your profile. If you''ve transferred, send us a support request.</li>
<li>Changes to your name and photo appear everywhere you''ve posted or commented, including in older conversations.</li>
</ul>',
  ARRAY['edit profile','change name','change photo','update bio','avatar','display name']::TEXT[], 0, true, 'PUBLISHED', NOW(), NOW(), NOW()
FROM "HelpCategory" c WHERE c."slug" = 'profile-privacy'
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpArticle" ("id","slug","categoryId","question","summary","body","keywords","sortOrder","isFeatured","status","createdAt","updatedAt","publishedAt")
SELECT gen_random_uuid(), 'how-does-blocking-work', c."id", 'How does blocking work?', 'Blocking hides you from that person in both directions — no messages, no profile access, and you''re removed from each other''s followers.',
  '<p>Blocking someone is immediate and applies in both directions:</p>
<ul>
<li>Neither of you can message the other, or start a new conversation.</li>
<li>Neither of you can see the other''s profile, posts or comments.</li>
<li>Any follow relationship between you is removed.</li>
<li>They aren''t told that you blocked them.</li>
</ul>
<p>To block someone, open their profile and choose <strong>Block</strong> from the menu. You can review and undo blocks under <strong>Settings → Privacy → Blocked accounts</strong>.</p>
<p>Blocking is a personal tool — it doesn''t tell our moderation team anything. If someone is harassing you or breaking the rules, please <strong>report</strong> them as well as blocking them.</p>',
  ARRAY['block','blocking','unblock','hide someone','stop contact']::TEXT[], 1, true, 'PUBLISHED', NOW(), NOW(), NOW()
FROM "HelpCategory" c WHERE c."slug" = 'profile-privacy'
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpArticle" ("id","slug","categoryId","question","summary","body","keywords","sortOrder","isFeatured","status","createdAt","updatedAt","publishedAt")
SELECT gen_random_uuid(), 'why-are-my-messages-not-sending', c."id", 'Why are my messages not sending?', 'Usually a connection problem. Check your network, reload, and confirm you haven''t been blocked or removed from the chat.',
  '<p>A message that won''t send is nearly always one of these:</p>
<ul>
<li><strong>Connection.</strong> Messages send over a live connection. On a weak or captive network (some campus Wi-Fi), it may not establish. Try mobile data, or reload the page.</li>
<li><strong>You''ve been blocked</strong>, or the other person has deleted their account. Messages to a blocked account don''t deliver.</li>
<li><strong>You''re no longer in the group.</strong> If you''ve been removed from a group chat, you can still see history but can''t post.</li>
<li><strong>The attachment is too large</strong> or an unsupported type — try sending the text on its own to check.</li>
</ul>
<p>If messages fail on more than one network and more than one conversation, that''s likely a fault on our side. Send us a support request and mention roughly when it started and whether it affects everyone or one chat.</p>',
  ARRAY['message not sending','cant send message','stuck sending','chat broken','message failed']::TEXT[], 0, true, 'PUBLISHED', NOW(), NOW(), NOW()
FROM "HelpCategory" c WHERE c."slug" = 'chat-messaging'
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpArticle" ("id","slug","categoryId","question","summary","body","keywords","sortOrder","isFeatured","status","createdAt","updatedAt","publishedAt")
SELECT gen_random_uuid(), 'how-do-i-join-or-leave-a-community', c."id", 'How do I join or leave a community?', 'Open the community and choose Join. To leave, open it again and choose Leave community from the menu.',
  '<p><strong>To join:</strong> find the community from Communities or search, open it, and choose <strong>Join</strong>. Open communities add you straight away. Private ones send a request to the moderators, who''ll approve or decline it — you''ll be notified either way.</p>
<p><strong>To leave:</strong> open the community, then choose <strong>Leave community</strong> from the menu. Your existing posts and comments stay unless you delete them.</p>
<p>If you''re the last moderator of a community you''ll be asked to hand the role to someone else before leaving, so the community isn''t left unmanaged.</p>',
  ARRAY['join community','leave community','group','membership','join request']::TEXT[], 0, true, 'PUBLISHED', NOW(), NOW(), NOW()
FROM "HelpCategory" c WHERE c."slug" = 'communities'
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpArticle" ("id","slug","categoryId","question","summary","body","keywords","sortOrder","isFeatured","status","createdAt","updatedAt","publishedAt")
SELECT gen_random_uuid(), 'how-do-i-create-or-join-an-event', c."id", 'How do I create or join an event?', 'Browse Events to join something, or use the create button to host your own with a time, place and capacity.',
  '<p><strong>To join:</strong> open <strong>Events</strong>, find something you like and choose <strong>Join</strong>. Some events have limited spaces or need the host to approve you; you''ll see which before you commit.</p>
<p><strong>To host:</strong> use the create button and add a title, description, date and time, location and how many people can come. You can invite specific people or leave it open to your campus.</p>
<p>Please only share a precise meeting location with people who are actually attending, and read the safety guidance before meeting anyone new in person.</p>',
  ARRAY['create event','join event','activity','meetup','rsvp','host']::TEXT[], 0, true, 'PUBLISHED', NOW(), NOW(), NOW()
FROM "HelpCategory" c WHERE c."slug" = 'events-activities'
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpArticle" ("id","slug","categoryId","question","summary","body","keywords","sortOrder","isFeatured","status","createdAt","updatedAt","publishedAt")
SELECT gen_random_uuid(), 'why-am-i-not-receiving-notifications', c."id", 'Why am I not receiving notifications?', 'Check your notification settings in Meetifyy first, then your device''s system permissions for the app or browser.',
  '<p>There are two separate switches, and both have to be on:</p>
<ol>
<li><strong>In Meetifyy:</strong> go to <strong>Settings → Notifications</strong> and check the categories you care about are enabled.</li>
<li><strong>On your device:</strong> your phone or browser has its own permission for Meetifyy. If you dismissed the permission prompt, notifications are blocked at that level regardless of your in-app settings. Re-enable it in your system or browser site settings.</li>
</ol>
<p>Also worth checking: Focus / Do Not Disturb modes, battery savers that suspend background activity, and — for email notifications — your spam folder.</p>',
  ARRAY['no notifications','notifications not working','push','alerts','email notifications']::TEXT[], 0, true, 'PUBLISHED', NOW(), NOW(), NOW()
FROM "HelpCategory" c WHERE c."slug" = 'notifications'
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpArticle" ("id","slug","categoryId","question","summary","body","keywords","sortOrder","isFeatured","status","createdAt","updatedAt","publishedAt")
SELECT gen_random_uuid(), 'how-do-i-report-a-user-or-content', c."id", 'How do I report a user or content?', 'Use the Report option in the menu on any profile, post, comment or message. Reports go to our moderation team.',
  '<p>Every profile, post, comment and message has a <strong>Report</strong> option in its menu. Choose it, pick the reason that fits best and add any detail that helps us understand what happened.</p>
<p>What happens next:</p>
<ul>
<li>Reports go to our moderation team, not to the person you reported.</li>
<li>The person you report isn''t told who reported them.</li>
<li>We review against our Community Guidelines and act on what we find — that can mean removing content, warning an account, or suspending it.</li>
</ul>
<p>Reporting and blocking are separate. If someone is bothering you, it''s fine to do both.</p>
<p><strong>If someone is in immediate danger, contact your local emergency services first.</strong> Then report it to us so we can act on the account.</p>',
  ARRAY['report user','report post','report comment','abuse','harassment','moderation']::TEXT[], 0, true, 'PUBLISHED', NOW(), NOW(), NOW()
FROM "HelpCategory" c WHERE c."slug" = 'safety-reporting'
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpArticle" ("id","slug","categoryId","question","summary","body","keywords","sortOrder","isFeatured","status","createdAt","updatedAt","publishedAt")
SELECT gen_random_uuid(), 'how-do-i-report-an-unsafe-meetup-or-event', c."id", 'How do I report an unsafe meetup/event?', 'Report the event from its page, or send us a support request under Safety & Reporting. Contact emergency services first if anyone is at risk.',
  '<p><strong>If anyone is in immediate danger, contact your local emergency services first.</strong> Your safety comes before reporting anything to us.</p>
<p>To report an event or a meetup:</p>
<ul>
<li>Open the event and choose <strong>Report</strong> from its menu, or</li>
<li>Send a support request from this page under <strong>Safety &amp; Reporting</strong>. You don''t need to be signed in.</li>
</ul>
<p>Tell us what happened, who was involved and when. Screenshots help. Reports about in-person safety are treated as urgent and are looked at ahead of the general queue.</p>
<p>A few habits worth keeping for any first meeting: meet somewhere public, tell a friend where you''re going, and leave if anything feels wrong.</p>',
  ARRAY['unsafe event','dangerous meetup','report event','safety','in person']::TEXT[], 1, true, 'PUBLISHED', NOW(), NOW(), NOW()
FROM "HelpCategory" c WHERE c."slug" = 'safety-reporting'
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpArticle" ("id","slug","categoryId","question","summary","body","keywords","sortOrder","isFeatured","status","createdAt","updatedAt","publishedAt")
SELECT gen_random_uuid(), 'the-app-is-slow-or-something-looks-broken', c."id", 'The app is slow or something looks broken. What can I do?', 'Reload, check your connection, clear the cached version, and tell us what you saw with your device and browser details.',
  '<p>Quick things that fix most of it:</p>
<ul>
<li><strong>Reload the page.</strong> On a stale tab, a hard refresh clears an old cached version.</li>
<li><strong>Check your connection</strong>, especially on campus Wi-Fi that needs a sign-in.</li>
<li><strong>Try another browser or device</strong> — this tells us whether the problem is yours or ours.</li>
<li><strong>Disable extensions</strong> temporarily; content and script blockers can break parts of the app.</li>
</ul>
<p>If it persists, send us a support request under <strong>Technical Issue</strong>. The form attaches your browser and device details automatically. A screenshot and the page you were on when it happened make it much faster to track down.</p>',
  ARRAY['slow','broken','not loading','blank page','bug','error','glitch']::TEXT[], 0, true, 'PUBLISHED', NOW(), NOW(), NOW()
FROM "HelpCategory" c WHERE c."slug" = 'technical-issues'
ON CONFLICT ("slug") DO NOTHING;

-- from 20260826140000_seed_posts_content_articles
-- Two articles for the "Posts & Content" category.
--
-- The initial seed created the category with nothing in it, which is the exact
-- state AdminHelpService.setCategoryStatus refuses to let an admin publish —
-- a heading on the public page with no articles under it. Same idempotent
-- insert as the first seed, so re-running changes nothing.


INSERT INTO "HelpArticle" ("id","slug","categoryId","question","summary","body","keywords","sortOrder","isFeatured","status","createdAt","updatedAt","publishedAt")
SELECT gen_random_uuid(), 'how-do-i-create-a-post', c."id", 'How do I create a post?', 'Use the composer on your feed to write a post, add photos, video or a poll, and choose where it goes.',
  '<p>Open your feed and use the composer at the top. You can add text, photos or video, and turn a post into a poll.</p>
<p>Before you post, choose where it goes: your own feed, or one of the communities you''re a member of. A post in a community is visible to that community''s members and follows its rules.</p>
<p>You can edit or delete your own posts afterwards from the menu on the post itself. Deleting removes it along with its comments.</p>',
  ARRAY['create post','new post','write post','share','upload photo','poll']::TEXT[], 0, false, 'PUBLISHED', NOW(), NOW(), NOW()
FROM "HelpCategory" c WHERE c."slug" = 'posts-content'
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpArticle" ("id","slug","categoryId","question","summary","body","keywords","sortOrder","isFeatured","status","createdAt","updatedAt","publishedAt")
SELECT gen_random_uuid(), 'why-was-my-post-removed', c."id", 'Why was my post or comment removed?', 'Content is removed when it breaks the Community Guidelines. You can ask us to review the decision.',
  '<p>Posts and comments are removed when they break our <strong>Community Guidelines</strong> — most often for harassment, hate speech, sexual content, spam, or sharing someone''s personal information without their consent.</p>
<p>A post can also disappear for reasons that aren''t moderation at all:</p>
<ul>
<li>The community it was posted in was deleted, or you left it.</li>
<li>The author''s account was deleted, which removes their content with it.</li>
<li>You blocked the author, or they blocked you, which hides their content from you.</li>
</ul>
<p>If you think a removal was a mistake, send us a support request under <strong>Posts &amp; Content</strong>. Tell us roughly what the post said and when you made it, and we''ll review it.</p>',
  ARRAY['post removed','deleted my post','comment removed','takedown','appeal','moderation']::TEXT[], 1, false, 'PUBLISHED', NOW(), NOW(), NOW()
FROM "HelpCategory" c WHERE c."slug" = 'posts-content'
ON CONFLICT ("slug") DO NOTHING;

-- from 20260826150000_help_content_plain_hyphens
-- Normalise long dashes in help-centre content to plain hyphens.
--
-- The seed migrations wrote em dashes (U+2014) and en dashes (U+2013) into
-- article bodies and summaries. Help & Support copy is standardised on the
-- plain hyphen, so this rewrites the stored content in place.
--
-- Done as its own migration rather than by editing the seed files: those have
-- already been applied, and Prisma records a checksum for every applied
-- migration, so changing one in place makes `migrate deploy` fail on any
-- database that already ran it. Running after the seeds also means a fresh
-- database gets the corrected text without the seed content being duplicated.
--
-- Idempotent: replacing a character that is no longer present is a no-op, so
-- this is safe to re-run and safe for content an admin has since edited.

UPDATE "HelpArticle"
SET "question" = REPLACE(REPLACE("question", U&'\2014', '-'), U&'\2013', '-'),
    "summary"  = REPLACE(REPLACE("summary",  U&'\2014', '-'), U&'\2013', '-'),
    "body"     = REPLACE(REPLACE("body",     U&'\2014', '-'), U&'\2013', '-')
WHERE "question" ~ U&'[\2013\2014]'
   OR "summary"  ~ U&'[\2013\2014]'
   OR "body"     ~ U&'[\2013\2014]';

UPDATE "HelpCategory"
SET "title"       = REPLACE(REPLACE("title",       U&'\2014', '-'), U&'\2013', '-'),
    "description" = REPLACE(REPLACE("description", U&'\2014', '-'), U&'\2013', '-')
WHERE "title"       ~ U&'[\2013\2014]'
   OR "description" ~ U&'[\2013\2014]';
