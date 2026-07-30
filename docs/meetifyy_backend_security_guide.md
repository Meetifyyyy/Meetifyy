Meetifyy Backend Security Guide
Prepared for the Meetifyy backend team | Stack: Node.js, Express.js, Socket.IO, Supabase, Upstash Redis, Cloudflare R2, Resend, Railway, Vercel
1. Security Goal
Meetifyy is not just a normal CRUD app. It will hold student identities, college information, profile data, chats, community memberships, event participation, internships, projects, uploaded media, and possibly private conversations. The backend must assume that users will try to access data that is not theirs, spam public endpoints, scrape student profiles, upload unsafe files, and abuse real-time chat.
The main backend security rule is simple:
Never trust the frontend. Every sensitive rule must be enforced on the backend and in Supabase RLS policies.
Frontend checks are useful for user experience, but they are not security controls. Anyone can call the API directly with Postman, curl, browser dev tools, or a script.
2. Highest Priority Checklist
Do these before any production launch:
•	Replace all mocked/localStorage auth with Supabase Auth sessions.
•	Enable Row Level Security on every Supabase table in exposed schemas, especially public.
•	Never expose Supabase service_role, database passwords, R2 secrets, Upstash tokens, Resend keys, or Railway secrets to the frontend.
•	Validate every request body, query param, route param, and file upload on the backend.
•	Add per-IP and per-user rate limits for login, signup, password reset, posting, comments, search, media upload, chat, and email-sending endpoints.
•	Add authorization checks for every object ID: posts, comments, clubs, events, projects, messages, uploads, notifications, and admin actions.
•	Lock CORS to the real frontend domains only.
•	Use Helmet, secure error handling, request size limits, and structured logs.
•	Authenticate Socket.IO connections during handshake and authorize every room join.
•	Use short-lived signed upload/download URLs for Cloudflare R2 instead of exposing bucket credentials.
•	Add security monitoring: failed logins, blocked rate limits, suspicious object access, upload failures, and admin actions.
3. Current Repo Observation
The public GitHub repository reviewed on 2026-07-13 appears to be frontend-only. The current React app uses mock data and stores auth/profile state in localStorage, including a mock password flow. That is acceptable for UI prototyping, but it must not be treated as production auth.
Production backend implementation should move identity, authorization, data writes, and sensitive reads to the backend plus Supabase RLS. The frontend should only store short-lived session state provided by Supabase Auth and should never be the source of truth for roles, permissions, profile ownership, club admin status, or event membership.
4. Authentication
Use Supabase Auth as the identity provider. The backend should verify the user's Supabase JWT on every protected API request.
Backend requirements:
•	Require Authorization: Bearer <access_token> on protected API routes.
•	Verify token signature, expiry, issuer, and audience using Supabase-supported verification methods.
•	Load the current user from the verified token, not from request body fields like userId, email, username, or role.
•	Never trust user_metadata for authorization because users can influence it. Store roles and privileged flags in server-controlled data such as app_metadata or protected database tables.
•	Keep admin roles separate from normal user profile data.
•	Use consistent account states: active, suspended, deleted, pending verification.
•	Add brute-force protection to login and password reset flows.
•	Avoid user enumeration. Login and password-reset messages should not reveal whether an email exists.
Recommended helper pattern:
// Conceptual middleware
async function requireAuth(req, res, next) {
  const token = extractBearerToken(req);
  if (!token) return res.status(401).json({ error: "Unauthorized" });
 
  const user = await verifySupabaseAccessToken(token);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
 
  req.auth = { userId: user.id, email: user.email };
  next();
}
Important: the authenticated user ID must come from the verified token. Do not accept userId from the client for ownership decisions.
5. Authorization and BOLA Prevention
The biggest API risk for Meetifyy is Broken Object Level Authorization, also called BOLA or IDOR. This happens when a user changes an ID in the URL/body and accesses another user's data.
Bad pattern:
DELETE /api/posts/post_123
If the backend only checks "is the user logged in?" then any logged-in user may delete any post by guessing/changing the ID.
Correct pattern:
•	Check the user is logged in.
•	Load the object.
•	Check ownership, membership, role, or policy.
•	Perform the action only if allowed.
Apply this to:
•	Profile edits: only the profile owner can edit normal profile fields.
•	Posts/comments: only owners or moderators can delete.
•	Clubs/communities: only club admins can update settings, approve members, or remove users.
•	Events/hackathons: only event owners/admins can edit; participants can only join/leave themselves.
•	DMs/group chats: only members can read, send, or list messages.
•	Notifications: users can only read/update their own notifications.
•	Media: users can only attach media they uploaded or have permission to use.
•	Admin/moderation routes: require explicit admin/moderator role checks.
Use centralized authorization helpers instead of scattering one-off checks:
async function canEditPost({ userId, postId }) {
  const post = await db.posts.findById(postId);
  if (!post) return false;
  return post.author_id === userId || await isModerator(userId, post.community_id);
}
6. Supabase Database Security
Supabase security should be designed around RLS, not only Express middleware.
Minimum rules:
•	Enable RLS on every table in exposed schemas.
•	Write separate RLS policies for select, insert, update, and delete.
•	Use auth.uid() or equivalent authenticated identity checks for row ownership.
•	For update, use both USING and WITH CHECK so users cannot reassign records to themselves or others.
•	Do not use TO authenticated alone as authorization. It only proves login, not ownership.
•	Do not put secrets or privileged admin logic in public client-accessible tables.
•	Do not create SECURITY DEFINER functions to "fix" permission problems unless absolutely necessary and carefully reviewed.
•	Keep private/internal tables in non-exposed schemas where possible.
•	Run Supabase database advisors before launch and after schema changes.
Example profile policy idea:
alter table profiles enable row level security;
 
create policy "Profiles are readable by authenticated users"
on profiles for select
to authenticated
using (true);
 
create policy "Users can update their own profile"
on profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);
Example private message policy idea:
create policy "Chat members can read messages"
on messages for select
to authenticated
using (
  exists (
    select 1
    from chat_members
    where chat_members.chat_id = messages.chat_id
      and chat_members.user_id = (select auth.uid())
  )
);
Avoid storing permissions in user-editable metadata. A user should never be able to make themselves club_admin, moderator, or verified_student by editing profile fields.
7. API Input Validation
Every endpoint should validate input with a schema library such as Zod, Joi, or Valibot.
Validate:
•	Required fields.
•	Type: string, number, boolean, enum, UUID, URL, date.
•	Length limits.
•	Allowed enum values.
•	File count and file size.
•	Pagination bounds.
•	Search query length.
•	Rich text/HTML policy.
•	Object IDs and ownership.
Examples:
•	Post text max length: define a clear limit.
•	Comment max length: shorter than posts.
•	Username: lowercase allowed characters only, with reserved words blocked.
•	College email: validate format, but do not rely on email domain alone for high-privilege access.
•	Event date: must be valid and within acceptable range.
•	Upload MIME type: allowlist only.
Reject unknown fields for sensitive operations. For example, an update profile API should not allow the client to send role, isAdmin, verified, followersCount, or createdAt.
8. Express.js Security Baseline
Use these defaults in the backend app:
import express from "express";
import helmet from "helmet";
import cors from "cors";
 
const app = express();
 
app.disable("x-powered-by");
 
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
 
app.use(cors({
  origin: [
    "https://meetify-web.vercel.app",
    "https://meetifyy.com"
  ],
  credentials: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
Also:
•	Use TLS/HTTPS only in production.
•	Set NODE_ENV=production.
•	Return generic error messages to clients.
•	Log full errors server-side, but never log passwords, tokens, OTPs, reset links, API keys, or private message content unless there is a strict debugging reason and redaction.
•	Use parameterized queries or Supabase client query builders instead of string-concatenated SQL.
•	Avoid open redirects. If the backend accepts redirect URLs, allowlist approved domains.
•	Add health endpoints that do not expose secrets or internal dependency details.
9. Rate Limiting and Abuse Protection
Meetifyy will have many abuse-prone flows:
•	Login and signup.
•	Password reset and email verification.
•	Search.
•	Profile scraping.
•	Posting/commenting/liking/following.
•	DM/chat sending.
•	Media uploads.
•	Link preview generation.
•	Resend email sending.
•	Socket.IO connection attempts and message events.
Use Upstash Redis for distributed rate limits so limits work across Railway instances.
Recommended limit categories:
•	IP limit: protects public unauthenticated routes.
•	User limit: stops logged-in users from spamming.
•	Route/action limit: different limits for login, search, upload, chat, and email.
•	Burst plus daily limit: for expensive or abuse-prone operations.
Example conceptual limits:
•	Login: strict per IP and per account/email.
•	Password reset: very strict per IP and per email.
•	Search: moderate per user/IP.
•	Upload: strict per user and total daily size.
•	Chat messages: per user per room and global per user.
•	Email sending: strict per user and per event type.
When a user is rate limited, return 429 Too Many Requests with a safe retry message. Do not leak whether an account/email exists.
10. Socket.IO Security
Socket.IO must be treated like another API surface, not as a trusted internal channel.
Connection rules:
•	Require authentication during the Socket.IO handshake.
•	Verify the Supabase access token before accepting the connection.
•	Attach userId to socket.data after verification.
•	Reject unauthenticated connections.
•	Restrict allowed origins.
•	Rate limit connection attempts.
Room rules:
•	Never allow the client to join arbitrary rooms by sending a room ID.
•	Before joining chat:<chatId>, verify the user is a member of that chat.
•	Before joining community:<id>, verify the user can access that community if it is private.
•	Before sending a message, verify membership again or rely on a trusted membership cache with short TTL.
•	Do not broadcast private events globally.
Event rules:
•	Validate every event payload.
•	Rate limit message sends, typing events, reactions, and presence updates.
•	Keep event names explicit and small.
•	Do not let clients set server-trusted fields like senderId, createdAt, isAdmin, or readBy.
Example conceptual pattern:
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const user = await verifySupabaseAccessToken(token);
    if (!user) return next(new Error("not authorized"));
    socket.data.userId = user.id;
    next();
  } catch {
    next(new Error("not authorized"));
  }
});
 
socket.on("chat:join", async ({ chatId }) => {
  const allowed = await isChatMember(socket.data.userId, chatId);
  if (!allowed) return;
  socket.join(`chat:${chatId}`);
});
11. Cloudflare R2 Upload Security
Do not upload files directly with permanent credentials from the browser.
Recommended flow:
1.	Frontend asks backend for an upload URL.
2.	Backend authenticates the user.
3.	Backend validates intended upload type, size, purpose, and ownership.
4.	Backend creates a short-lived pre-signed URL for one object key.
5.	Browser uploads directly to R2 with that pre-signed URL.
6.	Backend records metadata only after successful upload confirmation.
Rules:
•	Use short expiry times for pre-signed URLs.
•	Restrict content type in the signature when possible.
•	Generate object keys server-side. Do not let clients choose arbitrary paths.
•	Separate buckets or prefixes by environment: dev, staging, production.
•	Do not allow public write access.
•	Keep original filenames as metadata only after sanitization; do not use them as storage keys.
•	Allowlist MIME types and file extensions.
•	Enforce file size limits before signing and after upload.
•	Consider malware scanning before serving user-uploaded files broadly.
•	Serve downloads through signed URLs or controlled public URLs depending on privacy.
•	Configure R2 CORS to only allow Meetifyy frontend domains.
For avatars and post images, assume files are hostile. Never execute or transform uploaded files using unsafe shell commands.
12. Resend Email Security
Email endpoints are easy to abuse because attackers can use them for spam, phishing, and cost damage.
Rules:
•	Store Resend API keys only in Railway environment variables.
•	Use separate API keys for dev/staging/production.
•	Use domain verification and only send from approved Meetifyy domains.
•	Rate limit all email-triggering actions.
•	Use server-side templates. Do not let the client control full email HTML.
•	Escape user-controlled values inserted into templates.
•	Do not include sensitive tokens in logs.
•	Password reset and verification links must be single-use and expire quickly.
•	Webhook endpoints must verify the webhook signature if Resend provides one for the configured webhook flow.
•	Track bounces and complaints where possible.
Email types to protect:
•	Signup verification.
•	Password reset.
•	Club/event invite.
•	Notification digest.
•	Admin/moderation alerts.
13. Secrets and Environment Variables
Keep secrets out of GitHub, frontend bundles, logs, screenshots, and shared chat messages.
Backend-only secrets:
•	Supabase service role key.
•	Supabase database password/connection string.
•	Upstash Redis REST token.
•	Cloudflare R2 access key and secret key.
•	Resend API key.
•	JWT/session signing secrets if any.
•	Webhook signing secrets.
Frontend-allowed values:
•	Supabase publishable/anon key, only if RLS is correctly enabled.
•	Public API base URL.
•	Public asset URLs.
Rules:
•	Never prefix backend secrets with VITE_ or any frontend-exposed env prefix.
•	Use separate secrets per environment.
•	Rotate secrets after leaks, team member changes, or suspicious activity.
•	Add secret scanning in GitHub.
•	Keep .env.example with names only, no real values.
14. Data Privacy
Meetifyy handles student data, so collect only what is needed.
Protect these fields especially:
•	Email address.
•	Phone number, if collected.
•	College ID or verification document, if collected.
•	Private DMs.
•	Private group membership.
•	Location.
•	Internship/job application data.
•	Reports/moderation records.
Rules:
•	Avoid exposing full student profiles by default.
•	Let users control visibility of sensitive profile fields.
•	Do not return private fields in generic list/search endpoints.
•	Use separate DTO/response objects instead of returning raw database rows.
•	Add account deletion/export planning early.
•	Set retention periods for logs, deleted content, and moderation evidence.
15. Admin and Moderation Security
Admin features are high risk.
Rules:
•	Create explicit roles: user, club_admin, moderator, super_admin.
•	Store role assignments in protected server-controlled tables.
•	Require step-up checks or stricter monitoring for dangerous admin actions.
•	Log every admin action with actor, target, action, timestamp, and reason.
•	Prevent admins from silently reading private DMs unless there is a defined safety/moderation workflow.
•	Build moderation actions as audited workflows, not hidden database edits.
•	Keep super admin access extremely limited.
Admin endpoints should never rely on frontend route hiding. Every admin API route must enforce server-side role checks.
16. Search, Scraping, and Public Directory Protection
A student directory can be abused for scraping.
Rules:
•	Require login for student search unless public discovery is intentionally allowed.
•	Paginate every list endpoint.
•	Limit maximum page size.
•	Rate limit search heavily.
•	Avoid returning email, phone, private links, or exact location in search results.
•	Consider privacy settings for who can discover a profile.
•	Add suspicious behavior detection for sequential scraping and high-volume profile views.
17. Link Preview and SSRF Protection
If the backend generates link previews, it can become an SSRF risk.
Rules:
•	Validate URLs before fetching.
•	Allow only http and https.
•	Block private/internal IP ranges and localhost.
•	Follow a small number of redirects only.
•	Set strict timeouts and response size limits.
•	Do not send backend credentials when fetching external URLs.
•	Cache previews.
•	Sanitize preview titles/descriptions/images before storing or displaying.
18. Logging and Monitoring
Log enough to investigate abuse without leaking private data.
Log:
•	Auth success/failure patterns.
•	Rate limit blocks.
•	Permission denied events.
•	Admin actions.
•	File upload requests and failures.
•	Socket connection failures.
•	Suspicious object access attempts.
•	Email send failures/bounces.
Do not log:
•	Passwords.
•	Access tokens.
•	Refresh tokens.
•	OTPs.
•	Reset links.
•	Full private message content.
•	API keys.
Use request IDs so frontend, backend, Railway logs, Supabase logs, and Socket.IO events can be correlated.
19. Deployment Security
Railway backend:
•	Set production env vars only in Railway secret settings.
•	Use HTTPS.
•	Restrict CORS to production/staging frontend domains.
•	Set NODE_ENV=production.
•	Add health checks.
•	Avoid exposing debug routes.
•	Do not print env vars at startup.
Vercel frontend:
•	Only expose VITE_ variables that are safe for the browser.
•	Do not put service keys in frontend env vars.
•	Configure production API URL explicitly.
Namecheap domain:
•	Use HTTPS.
•	Configure DNS carefully for frontend/backend subdomains.
•	Add SPF, DKIM, and DMARC records for email deliverability and anti-spoofing.
Recommended subdomain split:
•	meetifyy.com or app.meetifyy.com: frontend.
•	api.meetifyy.com: backend API.
•	uploads.meetifyy.com or controlled R2 public domain: media, only if needed.
20. Dependency and Supply Chain Security
Rules:
•	Commit lockfiles.
•	Run npm audit regularly.
•	Remove unused packages.
•	Pin major versions intentionally.
•	Use Dependabot or GitHub security alerts.
•	Do not install random packages for auth, file upload, markdown parsing, or HTML sanitization without review.
•	Prefer maintained packages with recent releases and good security history.
•	Review Socket.IO, Express, Supabase, AWS SDK/R2, Redis, and email libraries before production.
21. Secure Backend Endpoint Checklist
For every new endpoint, the backend developer should answer:
•	Is this endpoint public or authenticated?
•	If authenticated, where is the user ID coming from?
•	What object IDs does it access?
•	Can the current user access those objects?
•	What fields can the user read or modify?
•	Is the input schema validated?
•	Is the response filtered to remove private/internal fields?
•	Is it rate limited?
•	Is it logged safely?
•	Does Supabase RLS also protect the data?
•	Are errors generic and safe?
•	Are tests written for unauthorized access?
22. Suggested Security Tests
Write tests for these cases:
•	User A cannot edit User B's profile.
•	User A cannot delete User B's post.
•	User A cannot read a private chat they are not a member of.
•	User A cannot join a Socket.IO room for another private chat.
•	Normal user cannot call admin routes.
•	Club member cannot perform club admin actions.
•	Client cannot set role, verified, isAdmin, or createdAt through profile update.
•	Expired/invalid JWT is rejected.
•	Missing JWT is rejected.
•	Rate limits return 429.
•	Upload rejects invalid MIME type and oversized files.
•	R2 signing endpoint does not allow arbitrary object keys.
•	Search endpoint does not leak private fields.
23. Minimum Backend Middleware Stack
Recommended packages:
•	helmet for security headers.
•	cors with strict allowed origins.
•	zod or joi for validation.
•	@supabase/supabase-js for Supabase.
•	@upstash/redis and @upstash/ratelimit for distributed rate limiting.
•	pino or winston for structured logging.
•	multer only if the backend directly receives files; prefer R2 signed URLs where possible.
Conceptual order:
app.disable("x-powered-by");
app.use(requestId());
app.use(helmet());
app.use(cors(strictCorsOptions));
app.use(express.json({ limit: "1mb" }));
app.use(publicRateLimit);
app.use("/api/auth", authRoutes);
app.use("/api", requireAuth);
app.use("/api", userRateLimit);
app.use("/api", apiRoutes);
app.use(notFoundHandler);
app.use(errorHandler);
24. Launch Readiness Checklist
Before launch:
•	RLS enabled and reviewed on all exposed tables.
•	No service keys in frontend or GitHub.
•	All protected routes require JWT.
•	All object-level authorization checks implemented.
•	All inputs validated with schemas.
•	Rate limits active in production using Upstash Redis.
•	Socket.IO auth and room authorization implemented.
•	R2 uploads use signed URLs and strict CORS.
•	Resend keys are scoped and email endpoints rate limited.
•	Railway/Vercel env vars separated by environment.
•	Logs redact secrets and tokens.
•	Admin actions audited.
•	Dependency audit completed.
•	Basic security tests passing.
•	Backup and incident response plan written.
25. Incident Response Basics
If something goes wrong:
7.	Disable affected endpoint or feature flag if possible.
8.	Rotate leaked keys immediately.
9.	Revoke compromised sessions where possible.
10.	Preserve logs.
11.	Identify affected users/data.
12.	Patch and add regression tests.
13.	Notify users/team according to severity.
Keep a private internal file with:
•	Who can rotate each secret.
•	Where logs are stored.
•	Who has Supabase/Railway/Vercel/Cloudflare/Resend access.
•	How to disable email, uploads, chat, and signups quickly.
26. Useful Official References
•	Express production security best practices: https://expressjs.com/en/advanced/best-practice-security/
•	Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
•	Supabase API security: https://supabase.com/docs/guides/api/securing-your-api
•	Socket.IO middlewares: https://socket.io/docs/v4/middlewares/
•	Socket.IO JWT usage: https://socket.io/how-to/use-with-jwt
•	Upstash Rate Limit: https://upstash.com/docs/redis/sdks/ratelimit-ts/overview
•	Cloudflare R2 pre-signed URLs: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
•	Cloudflare R2 CORS: https://developers.cloudflare.com/r2/buckets/cors/
•	Resend API authentication: https://resend.com/docs/api-reference/introduction
•	Resend API keys: https://resend.com/docs/dashboard/api-keys/introduction
•	OWASP API Security Top 10: https://owasp.org/www-project-api-security/
•	OWASP Node.js Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html
