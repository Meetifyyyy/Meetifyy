import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as webpush from 'web-push';
import { config } from '../../config';
import { PushMessage, SendOutcome } from '../push.types';
import { webPushPayload } from '../push-payload';
import { errorMessage } from '../../common/utils/error.util';

/** A Web Push subscription as stored on a PushDevice row. */
export interface WebPushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * What a push service's HTTP status means for the subscription.
 *
 * 404/410: the subscription is gone (unsubscribed, expired) - delete it.
 * 429/5xx and no status (network): retry later.
 * 400/401/403/413: something about OUR request is wrong (keys, payload) -
 * never a reason to delete the user's subscription.
 */
export function classifyWebPushStatus(
  statusCode: number | undefined,
): SendOutcome {
  if (statusCode === 404 || statusCode === 410) return { kind: 'gone' };
  if (statusCode === undefined || statusCode === 429 || statusCode >= 500) {
    return { kind: 'retry', reason: `web-push ${statusCode ?? 'network'}` };
  }
  return { kind: 'config', reason: `web-push ${statusCode}` };
}

/**
 * A topic header (RFC 8030 5.4) is at most 32 base64url characters. A hash of
 * the collapse key fits and reveals nothing.
 */
function topicFor(collapseKey: string): string {
  return crypto
    .createHash('sha256')
    .update(collapseKey)
    .digest('base64url')
    .slice(0, 32);
}

@Injectable()
export class WebPushProvider {
  private readonly logger = new Logger('PushWeb');

  get configured(): boolean {
    return config.push.web.configured;
  }

  async send(
    target: WebPushTarget,
    message: PushMessage,
  ): Promise<SendOutcome> {
    if (!this.configured)
      return { kind: 'config', reason: 'web push not configured' };
    try {
      await webpush.sendNotification(
        {
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth },
        },
        webPushPayload(message),
        {
          vapidDetails: {
            subject: config.push.web.subject,
            publicKey: config.push.web.publicKey,
            privateKey: config.push.web.privateKey,
          },
          TTL: message.ttlSeconds,
          urgency: message.urgency,
          topic: topicFor(message.collapseKey),
          timeout: 10_000,
        },
      );
      return { kind: 'sent' };
    } catch (err) {
      const status =
        err instanceof webpush.WebPushError ? err.statusCode : undefined;
      const outcome = classifyWebPushStatus(status);
      // Never the endpoint: it is a capability URL for this user's browser.
      if (outcome.kind === 'config') {
        this.logger.error(
          `web push rejected by the push service: ${status ?? errorMessage(err)}`,
        );
      }
      return outcome;
    }
  }
}
