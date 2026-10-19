import { Injectable, Logger } from '@nestjs/common';
import { App, cert, getApps, initializeApp } from 'firebase-admin/app';
import { Message, getMessaging } from 'firebase-admin/messaging';
import { config } from '../../config';
import { CATEGORY_CHANNEL, PushMessage, SendOutcome } from '../push.types';

const APP_NAME = 'meetifyy-push';

/** The `code` of a FirebaseMessagingError, without its `messaging/` prefix. */
function fcmCode(err: unknown): string {
  if (!err || typeof err !== 'object' || !('code' in err)) return '';
  const code = err.code;
  return typeof code === 'string' ? code.replace(/^messaging\//, '') : '';
}

/**
 * What an FCM error means for the token (https://firebase.google.com/docs/reference/fcm/rest/v1/ErrorCode).
 *
 * - registration-token-not-registered / invalid-registration-token: the token
 *   is dead. mismatched-credential (SENDER_ID_MISMATCH): it was issued by a
 *   different Firebase project - another environment's - and can never work
 *   with this one's credentials. All three delete the device.
 * - rate limits, server-unavailable, internal: retry.
 * - authentication / third-party-auth: our credentials are wrong. Never
 *   delete devices for that.
 */
export function classifyFcmError(err: unknown): SendOutcome {
  const code = fcmCode(err);
  switch (code) {
    case 'registration-token-not-registered':
    case 'invalid-registration-token':
    case 'mismatched-credential':
      return { kind: 'gone' };
    case 'message-rate-exceeded':
    case 'device-message-rate-exceeded':
    case 'server-unavailable':
    case 'internal-error':
    case 'unknown-error':
    case '':
      return { kind: 'retry', reason: `fcm ${code || 'network'}` };
    default:
      return { kind: 'config', reason: `fcm ${code}` };
  }
}

/** The FCM HTTP v1 message for one token. Exported for the payload-privacy tests. */
export function fcmMessage(token: string, message: PushMessage): Message {
  return {
    token,
    // A notification message, so the system tray shows it while the app is in
    // the background or killed, with no app code running.
    notification: { title: message.title, body: message.body },
    // Routing only: the Intent wire format, all strings.
    data: { ...message.intent },
    android: {
      priority: message.urgency === 'high' ? 'high' : 'normal',
      ttl: message.ttlSeconds * 1000,
      collapseKey: message.collapseKey,
      notification: {
        channelId: CATEGORY_CHANNEL[message.category],
        tag: message.collapseKey,
        icon: 'ic_stat_notify',
        // Hidden on a secure lock screen unless the user allows contents;
        // Android then shows the app name and "Contents hidden".
        visibility: 'private',
      },
    },
  };
}

@Injectable()
export class FcmProvider {
  private readonly logger = new Logger('PushFcm');
  private app: App | null = null;

  get configured(): boolean {
    return config.push.fcm.configured;
  }

  private messaging() {
    if (!this.app) {
      const account = config.push.fcm.serviceAccount;
      if (!account) return null;
      this.app =
        getApps().find((a) => a.name === APP_NAME) ??
        initializeApp(
          {
            credential: cert({
              projectId: account.projectId,
              clientEmail: account.clientEmail,
              privateKey: account.privateKey,
            }),
            projectId: account.projectId,
          },
          APP_NAME,
        );
    }
    return getMessaging(this.app);
  }

  async send(token: string, message: PushMessage): Promise<SendOutcome> {
    const messaging = this.configured ? this.messaging() : null;
    if (!messaging) return { kind: 'config', reason: 'fcm not configured' };
    try {
      await messaging.send(fcmMessage(token, message));
      return { kind: 'sent' };
    } catch (err) {
      const outcome = classifyFcmError(err);
      // Never the token.
      if (outcome.kind === 'config')
        this.logger.error(`FCM rejected the send: ${outcome.reason}`);
      return outcome;
    }
  }
}
