import { bool, invariant, str } from './env';

/**
 * Push notifications: Web Push (VAPID) for the website and FCM for the
 * installed Android app. See docs/push-notifications.md.
 *
 * Off unless PUSH_ENABLED=true. With it off the dispatcher enqueues nothing and
 * the registration endpoints still answer (so a client can be shipped before a
 * deployment is configured), they just report `enabled: false`.
 *
 * Every value here is per environment. A VAPID keypair and a Firebase project
 * are generated FRESH for each environment and never copied between them; the
 * isolation guard checks the naming it can see.
 */

/**
 * The service account JSON as a parsed object, or null.
 *
 * Accepted either raw or base64-encoded, because a multi-line JSON document is
 * awkward to hold in some secret stores. Only the three fields the Admin SDK's
 * `cert()` needs are kept; nothing else of the document is held in memory.
 */
export interface FcmServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

function parseServiceAccount(raw: string): FcmServiceAccount | null {
  if (!raw) return null;
  const text = raw.trimStart().startsWith('{')
    ? raw
    : Buffer.from(raw, 'base64').toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    invariant(false, 'Invalid FCM_SERVICE_ACCOUNT_JSON: not valid JSON');
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  const projectId = typeof o.project_id === 'string' ? o.project_id : '';
  const clientEmail = typeof o.client_email === 'string' ? o.client_email : '';
  const privateKey = typeof o.private_key === 'string' ? o.private_key : '';
  invariant(
    Boolean(projectId && clientEmail && privateKey),
    'Invalid FCM_SERVICE_ACCOUNT_JSON: project_id, client_email and private_key are required',
  );
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

const enabled = bool('PUSH_ENABLED');
const vapidPublicKey = str('VAPID_PUBLIC_KEY');
const vapidPrivateKey = str('VAPID_PRIVATE_KEY');
const vapidSubject = str('VAPID_SUBJECT');
const fcmProjectId = str('FCM_PROJECT_ID');
const fcmServiceAccount = parseServiceAccount(str('FCM_SERVICE_ACCOUNT_JSON'));

invariant(
  Boolean(vapidPublicKey) === Boolean(vapidPrivateKey),
  'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set together',
);
invariant(
  !vapidPublicKey || /^(mailto:|https:\/\/)/.test(vapidSubject),
  'VAPID_SUBJECT must be a mailto: or https:// URL when VAPID keys are set',
);
invariant(
  !fcmServiceAccount || fcmServiceAccount.projectId === fcmProjectId,
  'FCM_PROJECT_ID must equal the project_id of FCM_SERVICE_ACCOUNT_JSON',
);

export const pushConfigValues = {
  /** Master switch. Default off. */
  enabled,
  web: {
    /** Public by definition: the browser needs it to subscribe. */
    publicKey: vapidPublicKey,
    privateKey: vapidPrivateKey,
    subject: vapidSubject,
    configured: Boolean(vapidPublicKey && vapidPrivateKey && vapidSubject),
  },
  fcm: {
    projectId: fcmProjectId,
    serviceAccount: fcmServiceAccount,
    configured: Boolean(fcmServiceAccount),
  },
};

export type PushConfig = typeof pushConfigValues;
