-- Help-centre content, corrected against how the app actually works, plus
-- articles for features the seed did not cover (verification, visibility,
-- devices, first-year separation, Instant Match).
--
-- Corrections only touch a seeded row nobody has edited: the seed set
-- "updatedAt" = "createdAt", and any edit from the Admin Dashboard moves
-- "updatedAt". New articles are ON CONFLICT DO NOTHING. Re-running is a no-op
-- for anything an admin has touched.

UPDATE "HelpArticle"
SET "question" = 'How do I create a Meetifyy account?',
    "summary" = 'Sign up with your college email, confirm it with the 6-digit code we send, set a password and add a photo.',
    "body" = '<p>Signing up takes a couple of minutes:</p>
<ol><li>Choose <strong>Sign up</strong> and enter your name and a username.</li>
<li>Select your college and enter your <strong>college email address</strong>. Meetifyy places you on your campus from this address, so it has to be your institutional one.</li>
<li>Create a password.</li>
<li>Enter the 6-digit code we email you. Only the newest code works, so if you asked for another one, use the latest email.</li>
<li>Add a profile photo, or pick one of the preset characters.</li></ol>
<p><strong>College not in the list?</strong> It is not on Meetifyy yet. You can ask for it to be added from the college step of sign-up.</p>
<p>After signing up, verify your account (Settings, Account, Account Verification) to unlock posting, messaging and your campus.</p>',
    "keywords" = ARRAY['sign up','signup','register','new account','create account','college email','code']::TEXT[],
    "updatedAt" = "createdAt"
WHERE "slug" = 'how-do-i-create-a-meetifyy-account' AND "updatedAt" = "createdAt";

UPDATE "HelpArticle"
SET "question" = 'How do I delete my account?',
    "summary" = 'Settings, then Privacy & Security, then Delete Account. You have 30 days to change your mind.',
    "body" = '<p>Go to <strong>Settings</strong>, then <strong>Privacy &amp; Security</strong>, and choose <strong>Delete Account</strong> at the bottom. We email you a code to confirm it is really you.</p>
<p>Your account is then scheduled for deletion. <strong>For 30 days you can change your mind:</strong> sign in, choose <strong>Recover my account</strong> and enter the code we email you. After 30 days your profile, posts and messages are permanently erased.</p>
<p>Some records are kept where we must keep them, for example safety reports made about an account, so a report cannot be erased by deleting the account it is about.</p>
<p>Want a break rather than leaving? Turn on <strong>Private Profile</strong> under Settings, Visibility instead.</p>',
    "keywords" = ARRAY['delete account','close account','remove account','deactivate','erase data','recover account','30 days']::TEXT[],
    "updatedAt" = "createdAt"
WHERE "slug" = 'how-do-i-delete-my-account' AND "updatedAt" = "createdAt";

UPDATE "HelpArticle"
SET "question" = 'How do I change my profile information?',
    "summary" = 'Settings, Account, Edit Profile for your name, bio and birthday. Tap your photo or cover on your profile to change them.',
    "body" = '<ul><li><strong>Display name, bio and birthday:</strong> Settings, then Account, then <strong>Edit Profile</strong>. Remember to tap Save Changes.</li>
<li><strong>Profile photo and cover:</strong> open your own profile and tap your photo or your cover image.</li>
<li><strong>Course, branch and passing year:</strong> Settings, then Account, then <strong>Academic Info</strong>.</li>
<li><strong>Interests:</strong> Settings, then <strong>Interests &amp; Topics</strong>. These shape your feed and who is suggested to you.</li></ul>
<p>Your <strong>username</strong> and <strong>college</strong> cannot be changed. Your college comes from your verified college email. If you have moved college, send us a request from Help &amp; Support.</p>',
    "keywords" = ARRAY['edit profile','change name','change photo','update bio','avatar','display name','cover','username']::TEXT[],
    "updatedAt" = "createdAt"
WHERE "slug" = 'how-do-i-change-my-profile-information' AND "updatedAt" = "createdAt";

UPDATE "HelpArticle"
SET "question" = 'How does blocking work?',
    "summary" = 'Blocking stops someone messaging you and hides you from each other. Manage blocks in Settings, Privacy & Security, Blocked Contacts.',
    "body" = '<p>When you block someone:</p>
<ul><li>Neither of you can message the other.</li>
<li>You stop seeing each other''s profile, posts and comments.</li>
<li>They are not told that you blocked them.</li></ul>
<p><strong>To block someone</strong>, open your chat with them, tap their name to open the chat details, and choose <strong>Block</strong>. You can also block someone from a community''s member list.</p>
<p><strong>To unblock</strong>, go to Settings, then Privacy &amp; Security, then <strong>Blocked Contacts</strong>.</p>
<p>Blocking does not alert our team. If someone is harassing you, <strong>report</strong> them as well.</p>',
    "keywords" = ARRAY['block','blocking','unblock','hide someone','stop contact','blocked contacts']::TEXT[],
    "updatedAt" = "createdAt"
WHERE "slug" = 'how-does-blocking-work' AND "updatedAt" = "createdAt";

UPDATE "HelpArticle"
SET "question" = 'How do I join or leave a community?',
    "summary" = 'Open the community and tap Join (or Request to join for a private one). Tap Joined to leave.',
    "body" = '<p><strong>To join:</strong> open the community from Communities or search and tap <strong>Join</strong>. Private communities show <strong>Request to join</strong> instead; an admin of that community approves it, and until then the button shows Requested.</p>
<p><strong>To leave:</strong> open the community and tap <strong>Joined</strong>. Your earlier posts stay unless you delete them.</p>
<p>If you own the community, you have to hand ownership to another member before you can leave, so it is never left without an owner.</p>',
    "keywords" = ARRAY['join community','leave community','group','membership','join request','private community']::TEXT[],
    "updatedAt" = "createdAt"
WHERE "slug" = 'how-do-i-join-or-leave-a-community' AND "updatedAt" = "createdAt";

UPDATE "HelpArticle"
SET "question" = 'How do campus events and crew activities work?',
    "summary" = 'Campus events are listings for what is happening at your college. Crew activities are small plans you can join or host.',
    "body" = '<p><strong>Campus events</strong> (Campus, then Events) list what is happening at your college: date and time, venue, who is hosting and, where there is one, a registration link. To add one, tap <strong>Create event</strong>, fill it in and publish it. Registration, if the event needs it, happens on the organiser''s own link.</p>
<p><strong>Crew activities</strong> (Find Your Crew) are smaller plans, like a study session or a game, that people can join. Tap <strong>New activity</strong> to host one and set how many people can come. You can invite people directly, and leave an activity you joined at any time.</p>
<p>Meeting someone new? Meet somewhere public, tell a friend where you are going, and leave if anything feels wrong.</p>',
    "keywords" = ARRAY['create event','join event','activity','meetup','crew','campus events','host']::TEXT[],
    "updatedAt" = "createdAt"
WHERE "slug" = 'how-do-i-create-or-join-an-event' AND "updatedAt" = "createdAt";

UPDATE "HelpArticle"
SET "question" = 'Why am I not receiving notifications?',
    "summary" = 'Check Settings, Notifications in Meetifyy, then your phone''s or browser''s own notification permission for Meetifyy.',
    "body" = '<p>Two switches have to be on:</p>
<ol><li><strong>In Meetifyy:</strong> Settings, then <strong>Notifications</strong>. Turn on Push Notifications and/or Email Notifications and tap Save.</li>
<li><strong>On your device:</strong> your phone or browser has its own permission for Meetifyy. If you declined it, notifications stay blocked whatever Meetifyy is set to. Allow them in your phone''s app settings, or in your browser''s site settings.</li></ol>
<p>Also check Do Not Disturb or Focus modes and battery savers, which can hold notifications back, and your spam folder for emails.</p>',
    "keywords" = ARRAY['no notifications','notifications not working','push','alerts','email notifications']::TEXT[],
    "updatedAt" = "createdAt"
WHERE "slug" = 'why-am-i-not-receiving-notifications' AND "updatedAt" = "createdAt";

UPDATE "HelpArticle"
SET "question" = 'How do I report a user or content?',
    "summary" = 'Use Report in the menu on a profile, post, comment, message, community, group or crew activity.',
    "body" = '<p>Profiles, posts, comments, messages, communities, group chats and crew activities all have a <strong>Report</strong> option in their menu. Pick the reason that fits best and add any detail that helps.</p>
<ul><li>Reports go to the Meetifyy moderation team, never to the person you reported.</li>
<li>They are not told who reported them.</li>
<li>We review against the Community Guidelines and may remove content, warn, or suspend the account.</li></ul>
<p>You can block someone as well as reporting them.</p>
<p><strong>If anyone is in immediate danger, call 112 first.</strong> Free helplines are listed in the Safety centre.</p>',
    "keywords" = ARRAY['report user','report post','report comment','report message','abuse','harassment','moderation']::TEXT[],
    "updatedAt" = "createdAt"
WHERE "slug" = 'how-do-i-report-a-user-or-content' AND "updatedAt" = "createdAt";

UPDATE "HelpArticle"
SET "question" = 'How do I report an unsafe meetup or event?',
    "summary" = 'Call 112 if anyone is in danger. Report a crew activity from its menu; for anything else, send us a safety report.',
    "body" = '<p><strong>If anyone is in immediate danger, call 112 first.</strong></p>
<ul><li><strong>Crew activity:</strong> open its menu and choose <strong>Report</strong>.</li>
<li><strong>A campus event, or something that happened in person:</strong> open Help &amp; Support, choose <strong>Report a problem</strong> and pick <strong>Safety &amp; Reporting</strong>.</li></ul>
<p>Tell us what happened, who was involved and when. Screenshots help. Safety reports are reviewed ahead of everything else.</p>',
    "keywords" = ARRAY['unsafe event','dangerous meetup','report event','safety','in person']::TEXT[],
    "updatedAt" = "createdAt"
WHERE "slug" = 'how-do-i-report-an-unsafe-meetup-or-event' AND "updatedAt" = "createdAt";

UPDATE "HelpArticle"
SET "question" = 'How do I create a post?',
    "summary" = 'Use the composer at the top of your feed, or inside a community to post there. Add up to 6 photos or videos, or a poll.',
    "body" = '<p>Use the composer at the top of your <strong>Home</strong> feed. To post in a community, open the community and use the composer there; members of that community will see it.</p>
<ul><li>Add up to <strong>6 photos or videos</strong> to one post.</li>
<li>Tap <strong>Poll</strong> to ask a question with options people can vote on.</li></ul>
<p>Posts cannot be edited once published. To change one, delete it from the menu on the post and post again. Deleting a post removes its comments too.</p>
<p>Posting needs a verified account.</p>',
    "keywords" = ARRAY['create post','new post','write post','share','upload photo','poll','edit post']::TEXT[],
    "updatedAt" = "createdAt"
WHERE "slug" = 'how-do-i-create-a-post' AND "updatedAt" = "createdAt";

UPDATE "HelpArticle"
SET "question" = 'Why was my post or comment removed?',
    "summary" = 'Content that breaks the Community Guidelines is removed. If you think it was a mistake, ask us to review it.',
    "body" = '<p>Posts and comments are removed when they break the <strong>Community Guidelines</strong>, most often for harassment, hate speech, sexual content, spam, or sharing someone''s personal information without consent.</p>
<p>A post can also disappear for reasons that are not moderation:</p>
<ul><li>The community it was in was deleted.</li>
<li>Its author deleted their account.</li>
<li>You blocked the author, or they blocked you.</li></ul>
<p>If you think a removal was a mistake, use <strong>Report a problem</strong> in Help &amp; Support and choose Posts &amp; Content. Tell us roughly what it said and when.</p>',
    "keywords" = ARRAY['post removed','deleted my post','comment removed','takedown','appeal','moderation']::TEXT[],
    "updatedAt" = "createdAt"
WHERE "slug" = 'why-was-my-post-removed' AND "updatedAt" = "createdAt";

UPDATE "HelpArticle"
SET "question" = 'The app is slow or something looks broken. What can I do?',
    "summary" = 'Check your connection, update or reload the app, and if it continues, report it from Help & Support.',
    "body" = '<ul><li><strong>Check your connection</strong>, especially campus Wi-Fi that needs you to sign in first.</li>
<li><strong>On the app:</strong> install the latest update, then close and reopen Meetifyy.</li>
<li><strong>On the website:</strong> reload the page. Browser extensions that block content can break parts of it, so try with them off.</li></ul>
<p>Still happening? Use <strong>Report a problem</strong> in Help &amp; Support. Your app version and device are attached automatically, and a screenshot helps us find it faster.</p>',
    "keywords" = ARRAY['slow','broken','not loading','blank page','bug','error','glitch','update']::TEXT[],
    "updatedAt" = "createdAt"
WHERE "slug" = 'the-app-is-slow-or-something-looks-broken' AND "updatedAt" = "createdAt";

INSERT INTO "HelpArticle" ("id","slug","categoryId","question","summary","body","keywords","sortOrder","isFeatured","status","createdAt","updatedAt","publishedAt")
SELECT gen_random_uuid(), 'how-does-account-verification-work', c."id", 'How does account verification work?', 'Send a selfie and a photo of your college ID from Settings. Verification unlocks posting, messaging and your campus.',
  '<p>Verification confirms you are a real student at your college. Go to Settings, then Account, then <strong>Account Verification</strong>, and send:</p>
<ul><li>a <strong>selfie</strong>, so we know a real person is behind the account, and</li>
<li>a photo of your <strong>college ID card</strong>, to confirm your student status.</li></ul>
<p>Only the Meetifyy review team can see these photos. While your request is reviewed your status shows as pending. If it is turned down, the reason is shown and you can send it again.</p>
<p>A verified account can post, send messages, use Instant Match, and open your campus directory, events and communities.</p>',
  ARRAY['verify','verification','student id','college id','selfie','verified','pending','rejected']::TEXT[], 4, true, 'PUBLISHED', NOW(), NOW(), NOW()
FROM "HelpCategory" c WHERE c."slug" = 'account-login'
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpArticle" ("id","slug","categoryId","question","summary","body","keywords","sortOrder","isFeatured","status","createdAt","updatedAt","publishedAt")
SELECT gen_random_uuid(), 'how-do-i-sign-out-other-devices', c."id", 'How do I change my password or sign out other devices?', 'Settings, Privacy & Security: Change Password, or Devices to end a session on another phone or browser.',
  '<ul><li><strong>Change your password:</strong> Settings, then Privacy &amp; Security, then <strong>Change Password</strong>.</li>
<li><strong>See where you are signed in:</strong> Settings, then Privacy &amp; Security, then <strong>Devices</strong>. You can sign out any phone or browser you do not recognise.</li></ul>
<p>Forgot your password? Choose <strong>Forgot password</strong> on the sign-in screen and follow the emailed link.</p>
<p>If you think someone else got into your account, change your password first, then sign out every other device.</p>',
  ARRAY['password','change password','devices','sign out','log out','sessions','hacked']::TEXT[], 5, false, 'PUBLISHED', NOW(), NOW(), NOW()
FROM "HelpCategory" c WHERE c."slug" = 'account-login'
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpArticle" ("id","slug","categoryId","question","summary","body","keywords","sortOrder","isFeatured","status","createdAt","updatedAt","publishedAt")
SELECT gen_random_uuid(), 'who-can-see-my-profile', c."id", 'Who can see my profile and when I''m online?', 'Settings, Visibility: Private Profile limits your posts to approved followers. You can also hide your online status and read receipts.',
  '<p>Go to Settings, then <strong>Visibility</strong>:</p>
<ul><li><strong>Private Profile:</strong> only followers you approve see your posts. Others have to send a follow request.</li>
<li><strong>Show Online Status:</strong> turn off to stop others seeing when you are online.</li>
<li><strong>Read Receipts:</strong> turn off to stop others seeing when you have read their messages.</li></ul>
<p>Tap <strong>Save Visibility Settings</strong> when you are done.</p>',
  ARRAY['private profile','privacy','online status','read receipts','followers','visibility']::TEXT[], 2, true, 'PUBLISHED', NOW(), NOW(), NOW()
FROM "HelpCategory" c WHERE c."slug" = 'profile-privacy'
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpArticle" ("id","slug","categoryId","question","summary","body","keywords","sortOrder","isFeatured","status","createdAt","updatedAt","publishedAt")
SELECT gen_random_uuid(), 'why-cant-i-find-some-students', c."id", 'Why can''t I find or message some students?', 'First-year students and other years are kept apart: each group only sees and interacts with its own.',
  '<p>Meetifyy keeps <strong>first-year students</strong> and students in later years apart. First-years only see and interact with other first-years, and other students only see each other. This applies everywhere: search, suggestions, messages, comments and communities.</p>
<p>Your year comes from your verified college email and updates automatically when the academic year changes. It cannot be changed by hand.</p>
<p>Someone may also be hidden because one of you blocked the other, or because their account is no longer active.</p>',
  ARRAY['cant find','search','first year','fresher','missing user','hidden','batch']::TEXT[], 3, false, 'PUBLISHED', NOW(), NOW(), NOW()
FROM "HelpCategory" c WHERE c."slug" = 'profile-privacy'
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "HelpArticle" ("id","slug","categoryId","question","summary","body","keywords","sortOrder","isFeatured","status","createdAt","updatedAt","publishedAt")
SELECT gen_random_uuid(), 'what-is-instant-match', c."id", 'What is Instant Match?', 'Pick something you want to do and when, and Instant Match pairs you with another student for a 24-hour chat.',
  '<p>Instant Match finds someone on your campus who wants to do the same thing, right now.</p>
<ol><li>Open Instant Match and pick an activity.</li>
<li>Choose when you want to meet and add a short line about yourself.</li>
<li>Location is optional. It only helps rank who is closest, and your exact spot is never shown to anyone.</li></ol>
<p>When you are matched, a private chat opens for <strong>24 hours</strong>, then closes. You can start a new search whenever you like. Instant Match needs a verified account.</p>
<p>Meeting up? Pick somewhere public and tell a friend where you are going.</p>',
  ARRAY['instant match','match','meet','random','24 hours','chat']::TEXT[], 1, true, 'PUBLISHED', NOW(), NOW(), NOW()
FROM "HelpCategory" c WHERE c."slug" = 'chat-messaging'
ON CONFLICT ("slug") DO NOTHING;
